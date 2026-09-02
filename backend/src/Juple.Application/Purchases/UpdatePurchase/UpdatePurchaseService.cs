namespace Juple.Application.Purchases.UpdatePurchase;

public sealed class UpdatePurchaseService(IPurchaseStore purchaseStore) : IUpdatePurchaseService
{
    public Task UpdateAsync(
        long userId,
        long purchaseId,
        UpdatePurchaseCommand command,
        CancellationToken cancellationToken = default)
    {
        var fields = PurchaseFieldsNormalizer.Normalize(
            command.ItemId,
            command.ProductName,
            command.PurchaseDate,
            command.Amount,
            command.CurrencyCode,
            command.Store,
            command.Variant,
            command.Quantity,
            command.Memo);

        return purchaseStore.UpdateAsync(userId, purchaseId, fields, cancellationToken);
    }
}
