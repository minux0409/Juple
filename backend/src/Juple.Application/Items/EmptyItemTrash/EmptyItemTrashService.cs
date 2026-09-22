using Juple.Application.Images;

namespace Juple.Application.Items.EmptyItemTrash;

public sealed class EmptyItemTrashService(
    IItemLifecycleStore itemLifecycleStore,
    IItemImageStorage itemImageStorage) : IEmptyItemTrashService
{
    public async Task EmptyAsync(long userId, CancellationToken cancellationToken = default)
    {
        var deletedItemIds = await itemLifecycleStore.EmptyTrashAsync(userId, cancellationToken);

        // Best-effort, after the DB delete has already succeeded - mirrors DeleteItemService's own
        // ordering rationale, once per purged Item.
        foreach (var itemId in deletedItemIds)
        {
            await itemImageStorage.DeleteItemBlobsAsync(userId, itemId, cancellationToken);
        }
    }
}
