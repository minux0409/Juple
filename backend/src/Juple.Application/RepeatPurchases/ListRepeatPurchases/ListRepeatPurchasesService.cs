namespace Juple.Application.RepeatPurchases.ListRepeatPurchases;

public sealed class ListRepeatPurchasesService(IRepeatPurchaseStore repeatPurchaseStore) : IListRepeatPurchasesService
{
    public Task<RepeatPurchasePage> ListAsync(
        long userId,
        RepeatPurchasePageCursor? cursor,
        int limit,
        long? itemId,
        bool includeDisabled,
        CancellationToken cancellationToken = default) =>
        repeatPurchaseStore.ListAsync(userId, cursor, limit, itemId, includeDisabled, cancellationToken);
}
