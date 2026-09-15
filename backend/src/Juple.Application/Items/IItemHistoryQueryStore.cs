using Juple.Application.Images;

namespace Juple.Application.Items;

public interface IItemHistoryQueryStore
{
    /// <summary>
    /// All Items owned by userId, ordered by SavedAtUtc DESC, Id DESC - the original save moment.
    /// Deleted Items are hard-deleted (see ItemStore.DeleteAsync), so no extra exclusion filter is
    /// needed here. Each returned ItemHistoryEntryDto.RepresentativeImage/CoverImage is always null
    /// here - both are keyed by Item Id in the second/third tuple elements (raw BlobName refs, not
    /// yet resolved to a read URL) for the caller to resolve via IItemImageStorage. PreviewImageUrl
    /// (an external URL, not a Blob) is already fully populated on each ItemHistoryEntryDto.
    /// </summary>
    Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetHistoryAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Items saved (SavedAtUtc) within [fromUtc, toUtc) - a single local calendar date's UTC
    /// window, computed by the caller via DailyInboxDateRangeCalculator. Cursor-paginated using the
    /// exact same keyset cursor/ordering as GetHistoryAsync (SavedAtUtc DESC, Id DESC) - a day's
    /// worth of Items is unbounded, so this must never return the whole date range in one response.
    /// </summary>
    Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetByDateRangeAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
