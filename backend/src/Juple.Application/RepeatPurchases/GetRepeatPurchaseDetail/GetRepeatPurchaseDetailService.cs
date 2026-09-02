namespace Juple.Application.RepeatPurchases.GetRepeatPurchaseDetail;

public sealed class GetRepeatPurchaseDetailService(IRepeatPurchaseStore repeatPurchaseStore) : IGetRepeatPurchaseDetailService
{
    public async Task<RepeatPurchaseDto> GetAsync(
        long userId,
        long repeatPurchaseId,
        CancellationToken cancellationToken = default)
    {
        var repeatPurchase = await repeatPurchaseStore.GetAsync(userId, repeatPurchaseId, cancellationToken);
        return repeatPurchase ?? throw new RepeatPurchaseNotFoundException();
    }
}
