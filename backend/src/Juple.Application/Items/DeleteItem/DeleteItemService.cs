using Juple.Application.Images;

namespace Juple.Application.Items.DeleteItem;

public sealed class DeleteItemService(
    IItemLifecycleStore itemLifecycleStore,
    IItemImageStorage itemImageStorage,
    TimeProvider timeProvider) : IDeleteItemService
{
    public async Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
    {
        // A missing/other-user/already-deleted Item is a no-op here too (IItemLifecycleStore.DeleteAsync),
        // so the existing idempotent 204 semantics are unchanged. This moves the Item to the trash
        // rather than hard-deleting it - its Blobs, Collection memberships, and every other row are
        // left untouched (see Item.SoftDelete) so Restore brings it back exactly as it was.
        await itemLifecycleStore.DeleteAsync(userId, itemId, timeProvider.GetUtcNow(), cancellationToken);

        // Enforces the fixed per-user trash retention cap (see ItemTrashLimits) after every
        // delete, not just when actually over it - the store itself is a no-op when nothing needs
        // purging. Purged Items are hard-deleted, so their Blobs are cleaned up here exactly like a
        // direct permanent delete would (see PermanentlyDeleteItemService).
        var purgedItemIds = await itemLifecycleStore.PurgeOldestDeletedBeyondRetentionAsync(
            userId, ItemTrashLimits.MaxRetainedPerUser, cancellationToken);
        foreach (var purgedItemId in purgedItemIds)
        {
            await itemImageStorage.DeleteItemBlobsAsync(userId, purgedItemId, cancellationToken);
        }
    }
}
