namespace Juple.Application.Items.RestoreItem;

public sealed class RestoreItemService(IItemLifecycleStore itemLifecycleStore) : IRestoreItemService
{
    public Task RestoreAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        itemLifecycleStore.RestoreAsync(userId, itemId, cancellationToken);
}
