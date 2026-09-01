namespace Juple.Application.Items.DeleteItem;

public sealed class DeleteItemService(IItemLifecycleStore itemLifecycleStore) : IDeleteItemService
{
    public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        itemLifecycleStore.DeleteAsync(userId, itemId, cancellationToken);
}
