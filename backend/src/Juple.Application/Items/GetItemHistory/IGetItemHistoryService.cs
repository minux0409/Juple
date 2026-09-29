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

    /// <summary>
    /// How many History links GetRangeAsync pages through for the same [fromUtc, toUtc) window -
    /// one indexed COUNT, never the links (Home's exact "today" total while it pages).
    /// </summary>
    Task<int> CountRangeAsync(
        long userId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CancellationToken cancellationToken = default);
}
