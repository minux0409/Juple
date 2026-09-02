namespace Juple.Application.Purchases.CreatePurchase;

public sealed class CreatePurchaseService(
    IPurchaseStore purchaseStore,
    TimeProvider timeProvider) : ICreatePurchaseService
{
    public Task<PurchaseDto> CreateAsync(
        long userId,
        CreatePurchaseCommand command,
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

        return purchaseStore.CreateAsync(userId, fields, timeProvider.GetUtcNow(), cancellationToken);
    }
}
