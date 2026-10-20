using System.Buffers.Text;
using System.Security.Cryptography;
using System.Text.Json;
using Juple.Application.Collections.Locking;
using Juple.Domain.Users;

namespace Juple.Application.DataExport;

public interface IDataExportService
{
    /// <summary>What an export of the person's data contains, and how its photos are split into files.</summary>
    Task<DataExportSummary> GetSummaryAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Creates the download links for every file of one export (the data file and each photo file) after a RECENT sign-in - the export
    /// contains every memo and the content of locked Collections, the same bar as resetting the Collection lock password.
    /// </summary>
    /// <exception cref="DataExportDisabledException">Export is switched off.</exception>
    /// <exception cref="RecentAuthenticationRequiredException">The current sign-in is not recent enough.</exception>
    /// <exception cref="DataExportRateLimitedException">Too many export requests in the last 24 hours.</exception>
    Task<IReadOnlyList<DataExportLinkCreated>> CreateLinksAsync(long userId, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default);

    /// <summary>Resolves a download token to what it may download, counting one use. Null for an unknown, expired or used-up token.</summary>
    Task<DataExportDownload?> OpenDownloadAsync(string token, CancellationToken cancellationToken = default);

    Task WriteAsync(DataExportDownload download, Stream output, CancellationToken cancellationToken = default);
}

public sealed class DataExportService(
    DataExportOptions options,
    IDataExportReader reader,
    IDataExportLinkStore links,
    DataExportArchiveWriter writer,
    TimeProvider timeProvider) : IDataExportService
{
    private const int TokenBytes = 32;

    public async Task<DataExportSummary> GetSummaryAsync(long userId, CancellationToken cancellationToken = default)
    {
        EnsureEnabled();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.MaxDownloadSeconds));
        cancellationToken = deadline.Token;
        var counts = await reader.GetCountsAsync(userId, cancellationToken);
        ValidateCounts(counts);
        return new DataExportSummary(counts, await PlanImagePartsAsync(userId, cancellationToken));
    }

    public async Task<IReadOnlyList<DataExportLinkCreated>> CreateLinksAsync(long userId, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default)
    {
        EnsureEnabled();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.MaxDownloadSeconds));
        cancellationToken = deadline.Token;
        var nowUtc = timeProvider.GetUtcNow();
        RecentAuthentication.Require(authenticatedAtUtc, nowUtc);
        ValidateCounts(await reader.GetCountsAsync(userId, cancellationToken));

        if (await links.CountExportsSinceAsync(userId, nowUtc.AddDays(-1), cancellationToken) >= options.MaxExportsPerDay)
        {
            throw new DataExportRateLimitedException();
        }

        var expiresAtUtc = nowUtc + options.LinkLifetime;
        var created = new List<DataExportLinkCreated>();
        var rows = new List<DataExportLink>();
        var imageParts = await PlanImagePartsAsync(userId, cancellationToken);

        var dataToken = NewToken();
        rows.Add(new DataExportLink(userId, Hash(dataToken), DataExportPart.Data, null, null, null, nowUtc, expiresAtUtc, JsonSerializer.Serialize(imageParts)));
        created.Add(new DataExportLinkCreated(DataExportPart.Data, null, dataToken, expiresAtUtc, DataExportArchiveWriter.DataFileName(nowUtc), null, null));

        foreach (var part in imageParts)
        {
            var token = NewToken();
            rows.Add(new DataExportLink(userId, Hash(token), DataExportPart.Images, part.Number, part.FromImageId, part.ThroughImageId, nowUtc, expiresAtUtc));
            created.Add(new DataExportLinkCreated(
                DataExportPart.Images,
                part.Number,
                token,
                expiresAtUtc,
                DataExportArchiveWriter.ImagesFileName(nowUtc, part.Number),
                part.ImageCount,
                part.ByteCount));
        }

        await links.AddAsync(rows, options.MaxExportsPerDay, cancellationToken);
        return created;
    }

    public async Task<DataExportDownload?> OpenDownloadAsync(string token, CancellationToken cancellationToken = default)
    {
        if (!options.Enabled || !TryDecodeToken(token, out var raw))
        {
            return null;
        }

        var nowUtc = timeProvider.GetUtcNow();
        var link = await links.ClaimAsync(SHA256.HashData(raw), nowUtc, cancellationToken);
        if (link is null)
        {
            return null;
        }

        var fileName = link.Part == DataExportPart.Images
            ? DataExportArchiveWriter.ImagesFileName(link.CreatedAtUtc, link.ImagePartNumber!.Value)
            : DataExportArchiveWriter.DataFileName(link.CreatedAtUtc);
        if (link.Part == DataExportPart.Data && link.ImagePlanJson is null) return null; // Invalidate pre-hardening grants.
        var imageParts = link.ImagePlanJson is null ? null : JsonSerializer.Deserialize<List<DataExportImagePart>>(link.ImagePlanJson);
        return new DataExportDownload(link.UserId, link.Part, link.ImagePartNumber, link.FromImageId, link.ThroughImageId, fileName, imageParts);
    }

    public async Task WriteAsync(DataExportDownload download, Stream output, CancellationToken cancellationToken = default)
    {
        EnsureEnabled();
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        deadline.CancelAfter(TimeSpan.FromSeconds(options.MaxDownloadSeconds));
        cancellationToken = deadline.Token;
        if (await reader.GetAccountAsync(download.UserId, cancellationToken) is null) throw new DataExportPartNotFoundException();
        ValidateCounts(await reader.GetCountsAsync(download.UserId, cancellationToken));
        using var limited = new DataExportLimitedStream(output, options.MaxArchiveBytes);
        if (download.Part == DataExportPart.Images)
        {
            await writer.WriteImagesAsync(download.UserId, download.ImagePartNumber!.Value, download.FromImageId!.Value, download.ThroughImageId!.Value, limited, cancellationToken);
            return;
        }

        // Issued capabilities carry the same ranges as the companion photo files, even if photos changed since issuance.
        var parts = download.ImageParts ?? await PlanImagePartsAsync(download.UserId, cancellationToken);
        await writer.WriteDataAsync(download.UserId, parts, limited, cancellationToken);
    }

    private void ValidateCounts(DataExportCounts counts)
    {
        if ((long)counts.Links + counts.Comments + counts.Purchases + counts.RepeatPurchases + counts.Photos + counts.CollectionEntries > options.MaxRecords
            || (long)counts.OwnedCollections + counts.SharedMemberships > options.MaxCollections
            || counts.OwnedCollections + 10L > options.MaxArchiveEntries)
            throw new DataExportLimitExceededException();
    }

    private async Task<IReadOnlyList<DataExportImagePart>> PlanImagePartsAsync(long userId, CancellationToken cancellationToken)
    {
        // The reader is keyset-paged. Keep only the current part plus the compact part index here; never materialize every photo row.
        var parts = new List<DataExportImagePart>();
        long? fromImageId = null;
        long throughImageId = 0;
        var imageCount = 0;
        long byteCount = 0;
        await foreach (var image in reader.ReadImagesAsync(userId, null, null, cancellationToken))
        {
            var size = Math.Max(0, image.ByteLength);
            if (size > options.MaxImageBytesPerPart || parts.Count >= options.MaxArchiveEntries)
                throw new DataExportLimitExceededException();
            if (fromImageId is not null && (imageCount >= Math.Min(options.MaxImagesPerPart, options.MaxArchiveEntries - 1) || byteCount + size > options.MaxImageBytesPerPart))
            {
                parts.Add(new DataExportImagePart(parts.Count + 1, fromImageId.Value, throughImageId, imageCount, byteCount));
                fromImageId = null;
            }

            if (fromImageId is null)
            {
                fromImageId = image.ImageId;
                imageCount = 0;
                byteCount = 0;
            }

            throughImageId = image.ImageId;
            imageCount++;
            byteCount += size;
        }

        if (fromImageId is not null)
        {
            parts.Add(new DataExportImagePart(parts.Count + 1, fromImageId.Value, throughImageId, imageCount, byteCount));
        }

        return parts;
    }

    private void EnsureEnabled()
    {
        if (!options.Enabled)
        {
            throw new DataExportDisabledException();
        }
    }

    private static string NewToken() => Base64Url.EncodeToString(RandomNumberGenerator.GetBytes(TokenBytes));

    private static byte[] Hash(string token) => SHA256.HashData(Base64Url.DecodeFromChars(token));

    /// <summary>Only a well-formed token reaches the database: exactly 32 bytes of Base64Url.</summary>
    private static bool TryDecodeToken(string? token, out byte[] raw)
    {
        raw = [];
        // IsValid first: the decoder throws (rather than answering false) on a character outside the alphabet.
        if (string.IsNullOrEmpty(token)
            || token.Length != Base64Url.GetEncodedLength(TokenBytes)
            || !Base64Url.IsValid(token, out var decodedLength)
            || decodedLength != TokenBytes)
        {
            return false;
        }

        var buffer = new byte[TokenBytes];
        if (!Base64Url.TryDecodeFromChars(token, buffer, out var written) || written != TokenBytes)
        {
            return false;
        }

        raw = buffer;
        return true;
    }
}
