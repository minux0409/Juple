namespace Juple.Application.Purchases.DeletePurchase;

public interface IDeletePurchaseService
{
    Task DeleteAsync(long userId, long purchaseId, CancellationToken cancellationToken = default);
}
