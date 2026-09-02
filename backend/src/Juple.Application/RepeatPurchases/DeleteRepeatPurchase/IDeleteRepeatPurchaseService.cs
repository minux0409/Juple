namespace Juple.Application.RepeatPurchases.DeleteRepeatPurchase;

public interface IDeleteRepeatPurchaseService
{
    Task DeleteAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);
}
