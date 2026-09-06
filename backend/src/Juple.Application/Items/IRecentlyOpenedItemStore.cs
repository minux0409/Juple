namespace Juple.Application.Items;

/// <summary>
/// My Page's "최근 본 링크" (Recently opened links) persistence - a user opening their own saved
/// Item's original URL, never a click-analytics event log (see RecentlyOpenedItem). Every method
/// is scoped to the given userId; a missing/other-user Item never leaks through any of them.
/// </summary>
public interface IRecentlyOpenedItemStore
{
    /// <summary>
    /// Race-safe upsert: creates the (userId, itemId) row if none exists yet, otherwise advances
    /// its LastOpenedAtUtc - never adds a second row for the same pair. Throws
    /// <see cref="ItemNotFoundException"/> if itemId does not exist or is not owned by userId.
    /// </summary>
    Task RecordOpenAsync(
        long userId,
        long itemId,
        DateTimeOffset openedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>LastOpenedAtUtc DESC, ItemId DESC - see RecentlyOpenedItemPageCursor.</summary>
    Task<RecentlyOpenedItemPage> GetPageAsync(
        long userId,
        RecentlyOpenedItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Idempotent - a missing/already-deleted (userId, itemId) row succeeds too.</summary>
    Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default);

    /// <summary>Idempotent - removes every row for userId; already having none succeeds too.</summary>
    Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default);
}
