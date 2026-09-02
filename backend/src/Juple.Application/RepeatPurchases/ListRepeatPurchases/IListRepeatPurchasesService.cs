namespace Juple.Application.RepeatPurchases.ListRepeatPurchases;

public interface IListRepeatPurchasesService
{
    Task<RepeatPurchasePage> ListAsync(
        long userId,
        RepeatPurchasePageCursor? cursor,
        int limit,
        long? itemId,
        bool includeDisabled,
        CancellationToken cancellationToken = default);
}
