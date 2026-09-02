namespace Juple.Application.RepeatPurchases.RepeatPurchaseStateTransition;

public interface IRepeatPurchaseStateTransitionService
{
    Task<RepeatPurchaseDto> EnableAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);

    Task<RepeatPurchaseDto> DisableAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default);
}
