namespace Juple.Application.Purchases.ListPurchases;

public interface IListPurchasesService
{
    Task<PurchasePage> ListAsync(
        long userId,
        PurchasePageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
