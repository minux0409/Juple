namespace Juple.Application.Purchases.DeletePurchase;

public sealed class DeletePurchaseService(IPurchaseStore purchaseStore) : IDeletePurchaseService
{
    public Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default) =>
        purchaseStore.DeleteAsync(userId, purchaseId, cancellationToken);
}
