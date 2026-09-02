using Azure.Storage.Blobs;
using Azure.Storage.Blobs.Models;
using Azure.Storage.Sas;
using Juple.Application.Images;
using Juple.Application.Items;
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
    ILogger<ItemImageStore> logger) : IItemImageStore, IItemImageStorage
{
    private const int MaxImagesPerItem = 10;
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
        try
        {
            image = await InsertRowForLockedItemAsync(
                itemId, blobName, contentType, content.LongLength, createdAtUtc, cancellationToken);
        }
        catch
        {
            // The Blob already landed in Storage but the DB row never committed (cap exceeded,
            // or any other DB failure) - best-effort remove it rather than leaking an orphan. The
            // original failure is what must propagate to the caller regardless of cleanup outcome.
            await DeleteBlobBestEffortAsync(blobName);
            throw;
        }

        // Deliberately outside the try/catch above: the DB row is already committed by this
        // point, so a failure here must never be mistaken for an insert failure and trigger a
        // compensating Blob delete. CreateReadUrlAsync itself already degrades to null rather
        // than throwing on failure (see its own try/catch), so this is purely best-effort.
        var readUrl = await CreateReadUrlAsync(userId, blobName, cancellationToken);
        return image with { ReadUrl = readUrl };
    }

    /// <summary>
    /// Re-checks the per-Item image cap and computes SortOrder inside a short transaction that
    /// holds a row lock on the owning Item (via UPDLOCK+HOLDLOCK, not a new index/constraint) for
    /// its duration - this serializes concurrent uploads for the SAME Item so two requests can
    /// never both observe "9 of 10" and both insert, and never both compute the same SortOrder.
    /// The lock is acquired only after the Blob upload above, keeping the critical section short.
    /// </summary>
    private async Task<ItemImageDto> InsertRowForLockedItemAsync(
        long itemId,
        string blobName,
        string contentType,
        long byteLength,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        await dbContext.Items
            .FromSqlInterpolated($"SELECT * FROM items.Items WITH (UPDLOCK, HOLDLOCK) WHERE Id = {itemId}")
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        var existingCount = await dbContext.ItemImages
            .Where(image => image.ItemId == itemId)
            .CountAsync(cancellationToken);
        if (existingCount >= MaxImagesPerItem)
        {
            throw new ItemImageLimitExceededException();
        }

        var maxSortOrder = await dbContext.ItemImages
            .Where(image => image.ItemId == itemId)
            .Select(image => (int?)image.SortOrder)
            .MaxAsync(cancellationToken);
        var sortOrder = (maxSortOrder ?? -1) + 1;

        var image = new ItemImage(itemId, blobName, contentType, byteLength, sortOrder, createdAtUtc);
        dbContext.ItemImages.Add(image);
        await dbContext.SaveChangesAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);

        // ReadUrl is filled in by the caller (UploadAsync) after this method returns - by design,
        // never inside the try/catch that treats a failure here as an insert failure.
        return new ItemImageDto(image.Id, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc, ReadUrl: null);
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
            return;
        }

        var blobName = image.BlobName;
        dbContext.ItemImages.Remove(image);
        await dbContext.SaveChangesAsync(cancellationToken);

        // The DB row (source of truth) is already gone - a failure here just leaves an orphaned
        // Blob rather than blocking the delete the caller already observed as successful.
        await DeleteBlobBestEffortAsync(blobName);
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
            var userDelegationKey = await userDelegationKeyCache.GetOrRefreshAsync(cancellationToken);
            var uriBuilder = new BlobUriBuilder(blobClient.Uri)
            {
                Sas = sasBuilder.ToSasQueryParameters(userDelegationKey, blobServiceClient.AccountName),
            };
            return uriBuilder.ToUri();
        }
        catch (Exception exception)
        {
            // Sanitized: only the Blob's own (non-secret) path is logged - never the generated
            // URL/SAS query string, and never the storage account key or delegation key.
            logger.LogWarning(exception, "Failed to create a read URL for Blob {BlobName}.", blobName);
            return null;
        }
    }

    private async Task DeleteBlobBestEffortAsync(string blobName)
    {
        try
        {
            await blobContainerClient.GetBlobClient(blobName)
                .DeleteIfExistsAsync(cancellationToken: CancellationToken.None);
        }
        catch (Exception exception)
        {
            // Sanitized: only the Blob's own (non-secret) path is logged, and Azure SDK exception
            // messages never carry the connection string/SAS token used to reach them - never log
            // those directly regardless.
            logger.LogWarning(
                exception, "Failed to delete orphaned Blob {BlobName} during best-effort cleanup.", blobName);
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
