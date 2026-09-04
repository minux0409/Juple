namespace Juple.Application.Items.GetItemHistoryByDate;

public interface IGetItemHistoryByDateService
{
    Task<ItemHistoryByDateResult> GetAsync(
        long userId,
        string timeZoneId,
        DateOnly date,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
