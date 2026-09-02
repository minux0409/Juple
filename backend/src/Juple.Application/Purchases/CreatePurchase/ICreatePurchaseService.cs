namespace Juple.Application.Purchases.CreatePurchase;

public interface ICreatePurchaseService
{
    Task<PurchaseDto> CreateAsync(
        long userId,
        CreatePurchaseCommand command,
        CancellationToken cancellationToken = default);
}
