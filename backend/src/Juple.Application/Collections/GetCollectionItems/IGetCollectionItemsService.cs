namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemsService
{
    /// <summary>
    /// Owner or Contributor; for a locked Collection also a valid unlock grant for this user
    /// (CollectionLockedException otherwise - nothing is returned before the password is proven).
    /// sort picks the order of the whole Collection (see CollectionItemSort); cursor must be one this
    /// same order issued.
    /// </summary>
    Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CollectionItemSort sort = CollectionItemSort.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Same gates, rows, order and cursor as GetAsync, restricted to links added (AddedAtUtc) within
    /// [fromUtc, toUtc) - one date section (see IGetCollectionItemSectionsService). A cursor from this
    /// window only ever continues inside it.
    /// </summary>
    Task<CollectionItemPage> GetRangeAsync(
        long userId,
        long collectionId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The links added on ONE local calendar day (YYYY-MM-DD) in the caller's stored time zone: the same
    /// [start, next start) interval as GET items/calendar's count for that day, computed by the one shared helper
    /// (DailyInboxDateRangeCalculator) - the client never builds UTC bounds itself. Same gates, order and cursor as GetRangeAsync.
    /// </summary>
    Task<CollectionItemPage> GetByDateAsync(
        long userId,
        long collectionId,
        string timeZoneId,
        DateOnly date,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);

    /// <summary>Same gates; one link as the read-only shared view (null when not in this Collection).</summary>
    Task<SharedCollectionItemDto?> GetItemAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
