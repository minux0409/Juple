namespace Juple.Application.Purchases.ListPurchases;

public interface IListPurchasesService
{
    Task<PurchasePage> ListAsync(
        long userId,
        PurchasePageCursor? cursor,
        int limit,
        long? itemId = null,
        CancellationToken cancellationToken = default);
}
