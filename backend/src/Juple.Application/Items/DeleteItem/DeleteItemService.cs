using Juple.Application.Images;

namespace Juple.Application.Items.DeleteItem;

public sealed class DeleteItemService(
    IItemLifecycleStore itemLifecycleStore,
    IItemImageStorage itemImageStorage) : IDeleteItemService
{
    public async Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
    {
        // A missing/other-user Item is a no-op here too (IItemLifecycleStore.DeleteAsync), so the
        // existing idempotent 204 semantics are unchanged.
        await itemLifecycleStore.DeleteAsync(userId, itemId, cancellationToken);

        // Best-effort, after the DB delete has already succeeded - a failure here must never undo
        // or block the Item delete the caller already observed as successful. Deletes by prefix
        // rather than a pre-delete snapshot of BlobNames, so a Blob uploaded concurrently with
        // this delete is still cleaned up rather than orphaned.
        await itemImageStorage.DeleteItemBlobsAsync(userId, itemId, cancellationToken);
    }
}
