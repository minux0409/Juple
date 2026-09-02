namespace Juple.Application.Purchases.UpdatePurchase;

public interface IUpdatePurchaseService
{
    Task UpdateAsync(
        long userId,
        long purchaseId,
        UpdatePurchaseCommand command,
        CancellationToken cancellationToken = default);
}
