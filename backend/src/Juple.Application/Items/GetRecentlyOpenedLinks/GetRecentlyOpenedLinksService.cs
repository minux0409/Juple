namespace Juple.Application.Items.GetRecentlyOpenedLinks;

public sealed class GetRecentlyOpenedLinksService(IRecentlyOpenedItemStore recentlyOpenedItemStore)
    : IGetRecentlyOpenedLinksService
{
    public Task<RecentlyOpenedItemPage> GetAsync(
        long userId,
        RecentlyOpenedItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        recentlyOpenedItemStore.GetPageAsync(userId, cursor, limit, cancellationToken);
}
