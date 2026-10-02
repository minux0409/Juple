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
    /// <summary>
    /// With searchPattern (see ItemSearchPattern.ToContainsPattern) only the user's own Items whose
    /// Title, Url (so its host / site name) or own Memo contain the term - the same rows, order, cursor
    /// and page shape, so search results page exactly like History. Trash is never searched (deleted
    /// Items are not History rows at all).
    /// </summary>
    Task<(ItemHistoryPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetHistoryAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        string? searchPattern = null,
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

    /// <summary>
    /// The SavedAtUtc of the user's oldest History Item saved before beforeUtc (null: none) - one
    /// seek on IX_Items_UserId_SavedAtUtc_Id. Defaulted: only ItemStore implements the History summary.
    /// </summary>
    Task<DateTimeOffset?> GetOldestSavedAtUtcAsync(long userId, DateTimeOffset beforeUtc, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>
    /// How many History Items (the same rows GetHistoryAsync pages through) fall in each [FromUtc,
    /// ToUtc) window, in the given order - one query for every window, never one per window or per
    /// Item. Defaulted like GetOldestSavedAtUtcAsync.
    /// </summary>
    Task<IReadOnlyList<int>> CountByRangesAsync(
        long userId,
        IReadOnlyList<(DateTimeOffset FromUtc, DateTimeOffset ToUtc)> ranges,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();
}
