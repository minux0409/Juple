namespace Juple.Application.Items.GetItemHistory;

public interface IGetItemHistoryService
{
    Task<ItemHistoryPage> GetAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
