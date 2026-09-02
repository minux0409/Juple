using Juple.Application.Images;

namespace Juple.Application.Inbox;

public interface IInboxEntryStore
{
    Task<InboxEntrySaveResult> SaveAsync(
        long userId,
        string url,
        Guid? clientRequestId,
        DateTimeOffset savedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Each returned DailyInboxEntryDto.RepresentativeImage is always null here - representative
    /// images are keyed by Item Id in the second tuple element (raw BlobName refs, not yet
    /// resolved to a read URL) for the caller to resolve via IItemImageStorage.
    /// </summary>
    Task<(IReadOnlyList<DailyInboxEntryDto> Items, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetDailyAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default);
}
