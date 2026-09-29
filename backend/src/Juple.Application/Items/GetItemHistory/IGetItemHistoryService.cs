namespace Juple.Application.Items.GetItemHistory;

public interface IGetItemHistoryService
{
    Task<ItemHistoryPage> GetAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The same History rows, order, cursor and page shape as GetAsync, restricted to SavedAtUtc in
    /// [fromUtc, toUtc) - one History section's window (see GetItemHistorySectionsService). A cursor
    /// from this window only ever continues inside it.
    /// </summary>
    Task<ItemHistoryPage> GetRangeAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
