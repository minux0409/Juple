namespace Juple.Application.Items.GetRecentlyOpenedLinks;

public interface IGetRecentlyOpenedLinksService
{
    Task<RecentlyOpenedItemPage> GetAsync(
        long userId,
        RecentlyOpenedItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
