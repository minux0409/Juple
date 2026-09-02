namespace Juple.Application.Purchases.ListPurchases;

public sealed class ListPurchasesService(IPurchaseStore purchaseStore) : IListPurchasesService
{
    public Task<PurchasePage> ListAsync(
        long userId,
        PurchasePageCursor? cursor,
        int limit,
        long? itemId = null,
        CancellationToken cancellationToken = default) =>
        purchaseStore.ListAsync(userId, cursor, limit, itemId, cancellationToken);
}
