namespace Juple.Application.RepeatPurchases.DeleteRepeatPurchase;

public sealed class DeleteRepeatPurchaseService(IRepeatPurchaseStore repeatPurchaseStore) : IDeleteRepeatPurchaseService
{
    public Task DeleteAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
        repeatPurchaseStore.DeleteAsync(userId, repeatPurchaseId, cancellationToken);
}
