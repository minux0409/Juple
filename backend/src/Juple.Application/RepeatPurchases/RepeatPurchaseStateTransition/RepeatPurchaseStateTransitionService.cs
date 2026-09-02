namespace Juple.Application.RepeatPurchases.RepeatPurchaseStateTransition;

public sealed class RepeatPurchaseStateTransitionService(
    IRepeatPurchaseStore repeatPurchaseStore,
    TimeProvider timeProvider) : IRepeatPurchaseStateTransitionService
{
    public Task<RepeatPurchaseDto> EnableAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
        repeatPurchaseStore.EnableAsync(userId, repeatPurchaseId, timeProvider.GetUtcNow(), cancellationToken);

    public Task<RepeatPurchaseDto> DisableAsync(long userId, long repeatPurchaseId, CancellationToken cancellationToken = default) =>
        repeatPurchaseStore.DisableAsync(userId, repeatPurchaseId, timeProvider.GetUtcNow(), cancellationToken);
}
