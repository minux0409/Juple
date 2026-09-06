using Juple.Application.Images;

namespace Juple.Application.Items;

public interface IItemHistoryQueryStore
{
    /// <summary>
    /// All Items owned by userId, ordered by SavedAtUtc DESC, Id DESC - the original save moment.
    /// Deleted Items are hard-deleted (see ItemStore.DeleteAsync), so no extra exclusion filter is
    /// needed here. Each returned ItemHistoryEntryDto.RepresentativeImage is always null here -
    /// representative images are keyed by Item Id in the second tuple element (raw BlobName refs,
    /// not yet resolved to a read URL) for the caller to resolve via IItemImageStorage.
    /// </summary>
    Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetHistoryAsync(
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
    Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetByDateRangeAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
