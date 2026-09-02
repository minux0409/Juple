namespace Juple.Application.RepeatPurchases.GetRepeatPurchaseDetail;

public interface IGetRepeatPurchaseDetailService
{
    Task<RepeatPurchaseDto> GetAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);
}
