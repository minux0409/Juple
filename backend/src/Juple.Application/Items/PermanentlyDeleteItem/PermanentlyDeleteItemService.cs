using Juple.Application.Images;

namespace Juple.Application.Items.PermanentlyDeleteItem;

public sealed class PermanentlyDeleteItemService(
    IItemLifecycleStore itemLifecycleStore,
    IItemImageStorage itemImageStorage) : IPermanentlyDeleteItemService
{
    public async Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
    {
        // Throws ItemNotFoundException for a missing/other-user/still-active Item - an active Item
        // can never reach here (see IItemLifecycleStore.PermanentDeleteAsync).
        await itemLifecycleStore.PermanentDeleteAsync(userId, itemId, cancellationToken);

        // Best-effort, after the DB delete has already succeeded - mirrors DeleteItemService's own
        // ordering rationale.
        await itemImageStorage.DeleteItemBlobsAsync(userId, itemId, cancellationToken);
    }
}
