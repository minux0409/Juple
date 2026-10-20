using Juple.Domain.Users;

namespace Juple.Application.DataExport;

/// <summary>
/// Read-only access to ONE person's own data for the export. Every method is scoped by <c>userId</c>, which the caller resolved from the
/// authenticated principal (or a stored download link) - never from request input. Streams page through the database in bounded batches
/// so a large account never has to fit in memory.
/// </summary>
public interface IDataExportReader
{
    Task<DataExportAccount?> GetAccountAsync(long userId, CancellationToken cancellationToken = default);

    Task<DataExportCounts> GetCountsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>The person's own links (trash included), ordered by id.</summary>
    IAsyncEnumerable<DataExportItem> ReadItemsAsync(long userId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DataExportOwnedCollection>> GetOwnedCollectionsAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>The links of one Collection the person owns (an id the person does not own yields nothing), in the Collection's order.</summary>
    IAsyncEnumerable<DataExportCollectionEntry> ReadOwnedCollectionEntriesAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<DataExportMembership>> GetMembershipsAsync(long userId, CancellationToken cancellationToken = default);

    IAsyncEnumerable<DataExportComment> ReadCommentsAsync(long userId, CancellationToken cancellationToken = default);

    IAsyncEnumerable<DataExportPurchase> ReadPurchasesAsync(long userId, CancellationToken cancellationToken = default);

    IAsyncEnumerable<DataExportRepeatPurchase> ReadRepeatPurchasesAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The photos of the person's own links (trash included) ordered by id, optionally within an id range. Only the id and size are read
    /// when planning, but the same rows - with the blob name - are what a photo file is written from.
    /// </summary>
    IAsyncEnumerable<DataExportImageRef> ReadImagesAsync(long userId, long? fromImageId, long? throughImageId, CancellationToken cancellationToken = default);
}

/// <summary>Opens one of the person's own stored files for reading. Refuses any name outside that person's storage prefix.</summary>
public interface IDataExportFileSource
{
    /// <returns>The content stream, or null when the file no longer exists.</returns>
    Task<Stream?> OpenReadAsync(long userId, string blobName, CancellationToken cancellationToken = default);
}

public interface IDataExportLinkStore
{
    /// <summary>How many export requests the person made since the instant (each request has exactly one Data link).</summary>
    Task<int> CountExportsSinceAsync(long userId, DateTimeOffset sinceUtc, CancellationToken cancellationToken = default);

    /// <summary>Stores all links of one export request together.</summary>
    Task AddAsync(IReadOnlyCollection<DataExportLink> links, int maxExportsPerDay, CancellationToken cancellationToken = default);

    /// <summary>
    /// Atomically consumes the sole authorization for an unused link within its expiry and the 15-minute maximum age,
    /// returning it; otherwise null (unknown, expired, consumed, or its account was deleted).
    /// </summary>
    Task<DataExportLink?> ClaimAsync(byte[] tokenHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
