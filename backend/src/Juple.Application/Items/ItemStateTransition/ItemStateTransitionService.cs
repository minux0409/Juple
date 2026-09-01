namespace Juple.Application.Items.ItemStateTransition;

public sealed class ItemStateTransitionService(
    IItemLifecycleStore itemLifecycleStore,
    TimeProvider timeProvider) : IItemStateTransitionService
{
    public Task MoveToWishlistAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        itemLifecycleStore.MoveToWishlistAsync(userId, itemId, timeProvider.GetUtcNow(), cancellationToken);

    public Task MoveToArchiveAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        itemLifecycleStore.MoveToArchiveAsync(userId, itemId, timeProvider.GetUtcNow(), cancellationToken);
}
