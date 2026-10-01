using Azure;
using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Users.Profile;
using Juple.Domain.Images;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Images;

public sealed class ItemImageStore(
    JupleDbContext dbContext,
    BlobServiceClient blobServiceClient,
    BlobContainerClient blobContainerClient,
    UserDelegationKeyCache userDelegationKeyCache,
    ILogger<ItemImageStore> logger) : IItemImageStore, IItemImageStorage, ICollectionIconImageStorage, IUserProfileImageStorage
{
    private static readonly TimeSpan ReadUrlTtl = TimeSpan.FromMinutes(15);
    private static readonly TimeSpan ClockSkewBuffer = TimeSpan.FromMinutes(5);

    public async Task<IReadOnlyList<ItemImageDto>> ListAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        await RequireOwnedItemAsync(userId, itemId, cancellationToken);

        var rows = await dbContext.ItemImages
            .AsNoTracking()
            .Where(image => image.ItemId == itemId)
            .OrderBy(image => image.SortOrder)
            .ThenBy(image => image.Id)
            .Select(image => new
            {
                image.Id, image.BlobName, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc,
            })
            .ToListAsync(cancellationToken);

        // One DB query above for the whole list - each read URL below is a Storage-side signing
        // operation (or, on Production, reuses an already-cached delegation key), never a DB call.
        var results = new List<ItemImageDto>(rows.Count);
        foreach (var row in rows)
        {
            var readUrl = await CreateReadUrlAsync(userId, row.BlobName, cancellationToken);
            results.Add(new ItemImageDto(row.Id, row.ContentType, row.ByteLength, row.SortOrder, row.CreatedAtUtc, readUrl));
        }
        return results;
    }

    /// <summary>
    /// An Item has at most ONE photo of its own - its representative photo (대표 사진). An upload is
    /// therefore always "set the photo": the new Blob is stored first, then ONE short transaction
    /// adds its row, removes every previous row of the Item (including any extra rows saved back
    /// when two photos were allowed) and makes it the cover (CoverImageId), so it - not the
    /// automatic PreviewImageUrl - is what Home/Collections show. Only after that commits are the
    /// replaced Blobs deleted (best-effort): a failure anywhere before the commit leaves the Item
    /// with its previous photo exactly as it was, never with none.
    /// </summary>
    public async Task<ItemImageDto> UploadAsync(
        long userId,
        long itemId,
        ImageFormat format,
        byte[] content,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default)
    {
        await RequireOwnedItemAsync(userId, itemId, cancellationToken);

        var (contentType, extension) = GetFormatMetadata(format);
        // Never the client's own filename: a fresh, unguessable name under a path scoped to the
        // owning user and Item.
        var blobName = $"items/{userId}/{itemId}/{Guid.NewGuid():N}.{extension}";

        // Uploads to Blob Storage before opening any DB transaction - this can be slow, and must
        // never hold a DB lock/transaction open while it runs.
        var blobClient = blobContainerClient.GetBlobClient(blobName);
        await using (var uploadStream = new MemoryStream(content, writable: false))
        {
            await blobClient.UploadAsync(
                uploadStream,
                new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
                cancellationToken);
        }

        ItemImageDto image;
        IReadOnlyList<string> replacedBlobNames;
        try
        {
            (image, replacedBlobNames) = await ReplaceRowsForLockedItemAsync(
                itemId, blobName, contentType, content.LongLength, createdAtUtc, cancellationToken);
        }
        catch
        {
            // The Blob already landed in Storage but the DB row never committed (any DB failure) -
            // best-effort remove it rather than leaking an orphan. The previous photo is untouched.
            // The original failure is what must propagate to the caller regardless of cleanup outcome.
            await DeleteBlobBestEffortAsync(blobName);
            throw;
        }

        // The new photo is committed - only now may the photo(s) it replaced lose their Blobs.
        foreach (var replacedBlobName in replacedBlobNames)
        {
            await DeleteBlobBestEffortAsync(replacedBlobName);
        }

        // Deliberately outside the try/catch above: the DB row is already committed by this
        // point, so a failure here must never be mistaken for an insert failure and trigger a
        // compensating Blob delete. CreateReadUrlAsync itself already degrades to null rather
        // than throwing on failure (see its own try/catch), so this is purely best-effort.
        var readUrl = await CreateReadUrlAsync(userId, blobName, cancellationToken);
        return image with { ReadUrl = readUrl };
    }

    /// <summary>
    /// Swaps the Item's photo inside a short transaction that holds a row lock on the owning Item
    /// (via UPDLOCK+HOLDLOCK, not a new index/constraint) for its duration - this serializes
    /// concurrent uploads for the SAME Item, so of two racing uploads the later one simply replaces
    /// the earlier one and the Item still ends with exactly one photo. The lock is acquired only
    /// after the Blob upload above, keeping the critical section short. Returns the BlobNames of the
    /// rows it removed, for the caller to delete once this has committed.
    /// </summary>
    private async Task<(ItemImageDto Image, IReadOnlyList<string> ReplacedBlobNames)> ReplaceRowsForLockedItemAsync(
        long itemId,
        string blobName,
        string contentType,
        long byteLength,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        // FirstOrDefaultAsync (not FirstAsync): the Item can legitimately have been deleted in the
        // window between UploadAsync's own ownership check and this locked read (the Blob upload in
        // between takes real time) - that must surface as the same ItemNotFoundException a caller
        // would get from a delete that had simply already happened, never an unhandled
        // "sequence contains no elements" from FirstAsync. Tracked: its CoverImageId changes below.
        var lockedItem = await dbContext.Items
            .FromSqlInterpolated($"SELECT * FROM items.Items WITH (UPDLOCK, HOLDLOCK) WHERE Id = {itemId}")
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new ItemNotFoundException();

        // Every previous photo row of this Item - normally at most one, more only for an Item saved
        // when two were allowed. All of them go: the Item ends with exactly the new photo.
        var replaced = await dbContext.ItemImages
            .Where(image => image.ItemId == itemId)
            .ToListAsync(cancellationToken);

        var image = new ItemImage(itemId, blobName, contentType, byteLength, sortOrder: 0, createdAtUtc);
        dbContext.ItemImages.Add(image);
        dbContext.ItemImages.RemoveRange(replaced);
        // Assigns the new row's Id - needed for CoverImageId just below (no navigation to fix up).
        await dbContext.SaveChangesAsync(cancellationToken);

        // The Item's own photo is its representative photo, ahead of the automatic preview.
        lockedItem.SetCoverImageId(image.Id);
        await dbContext.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        // ReadUrl is filled in by the caller (UploadAsync) after this method returns - by design,
        // never inside the try/catch that treats a failure here as an insert failure.
        return (
            new ItemImageDto(image.Id, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc, ReadUrl: null),
            replaced.Select(row => row.BlobName).ToList());
    }

    public async Task DeleteAsync(
        long userId,
        long itemId,
        long imageId,
        CancellationToken cancellationToken = default)
    {
        var itemIsOwnedByUser = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (!itemIsOwnedByUser)
        {
            return;
        }

        var image = await dbContext.ItemImages
            .FirstOrDefaultAsync(image => image.Id == imageId && image.ItemId == itemId, cancellationToken);
        if (image is null)
        {
            // Already gone (e.g. a retried delete) - nothing else is touched, so a photo set since
            // then is never removed by a stale request.
            return;
        }

        // Deleting the Item's photo leaves it with none: an Item saved when two photos were allowed
        // loses its other row too, so no hidden photo comes back on the next load.
        var removed = await dbContext.ItemImages
            .Where(row => row.ItemId == itemId)
            .ToListAsync(cancellationToken);
        dbContext.ItemImages.RemoveRange(removed);

        // CoverImageId is deliberately not a DB-level FK (see Item.CoverImageId's own remarks), so
        // this is the one place that must keep it from going stale: clear it in the same
        // SaveChanges as the image row removal, so the representative image falls back to the
        // automatic PreviewImageUrl (or none).
        var owningItem = await dbContext.Items
            .FirstOrDefaultAsync(item => item.Id == itemId, cancellationToken);
        if (owningItem?.CoverImageId is { } coverImageId && removed.Any(row => row.Id == coverImageId))
        {
            owningItem.SetCoverImageId(null);
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        // The DB rows (source of truth) are already gone - a failure here just leaves an orphaned
        // Blob rather than blocking the delete the caller already observed as successful.
        foreach (var row in removed)
        {
            await DeleteBlobBestEffortAsync(row.BlobName);
        }
    }

    public async Task DeleteItemBlobsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        // Lists the Item's own prefix rather than trusting any previously-fetched snapshot of
        // BlobNames - a Blob uploaded after such a snapshot was taken (e.g. a concurrent upload
        // racing an Item delete) would otherwise be missed and orphaned forever. Scoped to
        // userId/itemId's own path, so this can never reach another user's Blobs.
        var prefix = $"items/{userId}/{itemId}/";

        try
        {
            await foreach (var blobItem in blobContainerClient.GetBlobsAsync(
                BlobTraits.None, BlobStates.None, prefix: prefix, cancellationToken: cancellationToken))
            {
                await DeleteBlobBestEffortAsync(blobItem.Name);
            }
        }
        catch (Exception exception)
        {
            // The DB Item delete has already committed by the time this runs - a Storage-side
            // failure to even list the prefix (not just an individual Blob delete, already
            // handled in DeleteBlobBestEffortAsync) must not surface as a failed Item delete.
            logger.LogWarning(
                exception,
                "Failed to enumerate Blobs under prefix {BlobPrefix} during best-effort Item cleanup.",
                prefix);
        }
    }

    public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

    public async Task<bool> DeleteBlobsByPrefixAsync(
        string prefix,
        CancellationToken cancellationToken = default)
    {
        // Listed directly from Blob Storage, same rationale as DeleteItemBlobsAsync: never trust a
        // DB/pre-delete snapshot of BlobNames.
        var allDeleted = true;

        try
        {
            await foreach (var blobItem in blobContainerClient.GetBlobsAsync(
                BlobTraits.None, BlobStates.None, prefix: prefix, cancellationToken: cancellationToken))
            {
                if (!await DeleteBlobBestEffortAsync(blobItem.Name))
                {
                    allDeleted = false;
                }
            }
        }
        catch (Exception exception)
        {
            // The caller's own SQL deletion (e.g. account deletion) has already committed by the
            // time this runs - same rationale as DeleteItemBlobsAsync's catch block. Unlike that
            // method, this reports the failure back via its return value rather than only logging,
            // so a caller with a durability requirement (see IBlobCleanupService) knows to retry.
            logger.LogWarning(
                exception,
                "Failed to enumerate Blobs under prefix {BlobPrefix} during cleanup.",
                prefix);
            return false;
        }

        return allDeleted;
    }

    public async Task<Uri?> CreateReadUrlAsync(
        long userId,
        string blobName,
        CancellationToken cancellationToken = default)
    {
        if (!blobName.StartsWith($"items/{userId}/", StringComparison.Ordinal))
        {
            // Every BlobName is created under exactly this prefix (see UploadAsync) - a mismatch
            // means a caller passed a BlobName it never verified ownership of, which must never
            // happen. Fail loudly instead of ever signing a URL for another user's Blob.
            throw new InvalidOperationException(
                "Refusing to create a read URL for a Blob outside the caller's own userId prefix.");
        }

        var stage = ReadUrlStage.Sign;
        try
        {
            var blobClient = blobContainerClient.GetBlobClient(blobName);
            var sasBuilder = new BlobSasBuilder
            {
                BlobContainerName = blobContainerClient.Name,
                BlobName = blobName,
                Resource = "b",
                StartsOn = DateTimeOffset.UtcNow.Subtract(ClockSkewBuffer),
                ExpiresOn = DateTimeOffset.UtcNow.Add(ReadUrlTtl),
            };
            sasBuilder.SetPermissions(BlobSasPermissions.Read);

            if (blobClient.CanGenerateSasUri)
            {
                // Local/Azurite: the client holds a Shared Key credential, so it can sign
                // directly - no extra network call, no User Delegation Key involved. Protocol is
                // left at its default (HttpsAndHttp): local Azurite runs over plain HTTP (see
                // infra/local/compose.yaml), and restricting to HTTPS-only here would break it.
                return blobClient.GenerateSasUri(sasBuilder);
            }

            // Production: the client is Managed-Identity-authenticated (no account key held by
            // this app at all) - sign with a cached User Delegation Key instead, and require
            // HTTPS, since a real Storage Account is always reachable over HTTPS.
            sasBuilder.Protocol = SasProtocol.Https;
            stage = ReadUrlStage.DelegationKey;
            var userDelegationKey = await userDelegationKeyCache.GetOrRefreshAsync(cancellationToken);
            stage = ReadUrlStage.Sign;
            var uriBuilder = new BlobUriBuilder(blobClient.Uri)
            {
                Sas = sasBuilder.ToSasQueryParameters(userDelegationKey, blobServiceClient.AccountName),
            };
            return uriBuilder.ToUri();
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // The caller's own request was aborted (e.g. the app gave up waiting) - nothing failed,
            // and nobody will read this response. Any shared key fetch carries on regardless.
            logger.LogDebug("Read URL not created: the request was cancelled ({ImageKind}, stage {Stage}).", ImageKindOf(blobName), stage);
            return null;
        }
        catch (Exception exception)
        {
            // A real failure while the request is still alive (the key fetch failed or timed out,
            // or signing failed). Structured and sanitized: no Blob path (it carries internal user
            // and Collection ids), no URL/SAS query string, no key or token - only what failed.
            var requestFailed = exception as RequestFailedException;
            logger.LogWarning(
                "Failed to create a read URL ({ImageKind}, stage {Stage}): {ExceptionType}, status {Status}, error code {ErrorCode}.",
                ImageKindOf(blobName),
                stage,
                exception.GetType().Name,
                requestFailed?.Status,
                requestFailed?.ErrorCode);
            return null;
        }
    }

    private enum ReadUrlStage
    {
        DelegationKey,
        Sign,
    }

    /// <summary>Which kind of photo a Blob is - a log label that identifies no user or Collection.</summary>
    private static string ImageKindOf(string blobName) =>
        blobName.Contains("/collections/", StringComparison.Ordinal) ? "collectionIcon"
        : blobName.Contains("/profile/", StringComparison.Ordinal) ? "profileImage"
        : "itemImage";

    // ---------- Collection icon photos (same container/prefix/signing as Item images) ----------

    /// <summary>"items/{ownerUserId}/collections/{collectionId}/" - inside the Owner's own prefix (so account deletion removes it) and never colliding with an Item's numeric "items/{userId}/{itemId}/" folder.</summary>
    private static string CollectionIconPrefix(long ownerUserId) => $"items/{ownerUserId}/collections/";

    public async Task<string> UploadCollectionIconAsync(
        long ownerUserId,
        long collectionId,
        ImageFormat format,
        byte[] content,
        CancellationToken cancellationToken = default)
    {
        var (contentType, extension) = GetFormatMetadata(format);
        var blobName = $"{CollectionIconPrefix(ownerUserId)}{collectionId}/{Guid.NewGuid():N}.{extension}";
        await using var uploadStream = new MemoryStream(content, writable: false);
        await blobContainerClient.GetBlobClient(blobName).UploadAsync(
            uploadStream,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
            cancellationToken);
        return blobName;
    }

    public async Task DeleteCollectionIconAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default)
    {
        if (!blobName.StartsWith(CollectionIconPrefix(ownerUserId), StringComparison.Ordinal))
        {
            logger.LogWarning("Refusing to delete a Blob outside the Owner's collection-icon prefix.");
            return;
        }

        await DeleteBlobBestEffortAsync(blobName);
    }

    public Task<Uri?> CreateCollectionIconReadUrlAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) =>
        // A stored name outside this Owner's icon prefix is never signed (and never breaks a list).
        blobName.StartsWith(CollectionIconPrefix(ownerUserId), StringComparison.Ordinal)
            ? CreateReadUrlAsync(ownerUserId, blobName, cancellationToken)
            : Task.FromResult<Uri?>(null);

    // ---------- Profile photos (same container/prefix/signing as Item images) ----------

    /// <summary>"items/{userId}/profile/" - inside the user's own prefix (so account deletion removes it) and never colliding with an Item's numeric "items/{userId}/{itemId}/" folder or "collections/".</summary>
    private static string ProfileImagePrefix(long userId) => $"items/{userId}/profile/";

    public async Task<string> UploadProfileImageAsync(
        long userId,
        ImageFormat format,
        byte[] content,
        CancellationToken cancellationToken = default)
    {
        var (contentType, extension) = GetFormatMetadata(format);
        var blobName = $"{ProfileImagePrefix(userId)}{Guid.NewGuid():N}.{extension}";
        await using var uploadStream = new MemoryStream(content, writable: false);
        await blobContainerClient.GetBlobClient(blobName).UploadAsync(
            uploadStream,
            new BlobUploadOptions { HttpHeaders = new BlobHttpHeaders { ContentType = contentType } },
            cancellationToken);
        return blobName;
    }

    public async Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default)
    {
        if (!blobName.StartsWith(ProfileImagePrefix(userId), StringComparison.Ordinal))
        {
            logger.LogWarning("Refusing to delete a Blob outside the user's profile-image prefix.");
            return;
        }

        await DeleteBlobBestEffortAsync(blobName);
    }

    public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
        // A stored name outside this user's profile prefix is never signed (and never breaks a list).
        blobName.StartsWith(ProfileImagePrefix(userId), StringComparison.Ordinal)
            ? CreateReadUrlAsync(userId, blobName, cancellationToken)
            : Task.FromResult<Uri?>(null);

    /// <summary>Returns whether the delete (or a not-found no-op) succeeded, for callers that need
    /// to know (see DeleteBlobsByPrefixAsync); callers that don't just discard it, unchanged from
    /// when this returned void.</summary>
    private async Task<bool> DeleteBlobBestEffortAsync(string blobName)
    {
        try
        {
            await blobContainerClient.GetBlobClient(blobName)
                .DeleteIfExistsAsync(cancellationToken: CancellationToken.None);
            return true;
        }
        catch (Exception exception)
        {
            // Sanitized: only the Blob's own (non-secret) path is logged, and Azure SDK exception
            // messages never carry the connection string/SAS token used to reach them - never log
            // those directly regardless.
            logger.LogWarning(
                exception, "Failed to delete orphaned Blob {BlobName} during best-effort cleanup.", blobName);
            return false;
        }
    }

    private async Task RequireOwnedItemAsync(long userId, long itemId, CancellationToken cancellationToken)
    {
        var itemIsOwnedByUser = await dbContext.Items
            .AsNoTracking()
            .AnyAsync(item => item.Id == itemId && item.UserId == userId, cancellationToken);
        if (!itemIsOwnedByUser)
        {
            throw new ItemNotFoundException();
        }
    }

    private static (string ContentType, string Extension) GetFormatMetadata(ImageFormat format) => format switch
    {
        ImageFormat.Jpeg => ("image/jpeg", "jpg"),
        ImageFormat.Png => ("image/png", "png"),
        ImageFormat.WebP => ("image/webp", "webp"),
        _ => throw new ArgumentOutOfRangeException(nameof(format), format, "Unknown ImageFormat."),
    };
}
