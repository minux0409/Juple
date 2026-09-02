namespace Juple.Application.Purchases.GetPurchaseDetail;

public sealed class GetPurchaseDetailService(IPurchaseStore purchaseStore) : IGetPurchaseDetailService
{
    public async Task<PurchaseDto> GetAsync(
        long userId,
        long purchaseId,
        CancellationToken cancellationToken = default)
    {
        var purchase = await purchaseStore.GetAsync(userId, purchaseId, cancellationToken);
        return purchase ?? throw new PurchaseNotFoundException();
    }
}
