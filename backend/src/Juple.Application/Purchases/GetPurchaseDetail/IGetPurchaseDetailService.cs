namespace Juple.Application.Purchases.GetPurchaseDetail;

public interface IGetPurchaseDetailService
{
    Task<PurchaseDto> GetAsync(long userId, long purchaseId, CancellationToken cancellationToken = default);
}
