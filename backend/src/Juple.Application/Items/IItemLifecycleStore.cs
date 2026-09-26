namespace Juple.Application.Items;

public interface IItemLifecycleStore
{
    /// <summary>
    /// Soft-deletes (moves to trash) the caller's Item if it exists and is not already deleted.
    /// A missing Item (never existed, owned by another user, or already deleted) is treated as
    /// already reaching the desired state and completes without error - keeps this idempotent
    /// under retry, exactly like the hard-delete this endpoint used to be.
    /// </summary>
    Task DeleteAsync(
        long userId,
        long itemId,
        DateTimeOffset deletedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Restores a trashed Item back to active. A missing/other-user/not-currently-deleted Item
    /// throws ItemNotFoundException - unlike DeleteAsync, restoring something that isn't in the
    /// trash is a caller error, not an idempotent no-op.
    /// </summary>
    Task RestoreAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes a single trashed Item (cascades to ItemImages/CollectionItems - see their own
    /// FK configuration). Throws ItemNotFoundException for a missing/other-user/still-active Item
    /// - an active Item can never be permanently deleted through this path.
    /// </summary>
    Task PermanentDeleteAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes every one of the caller's trashed Items - the entire trash server-side, not
    /// just whatever the capped trash list UI shows. Returns the deleted Items' ids so the caller
    /// can best-effort clean up their Blobs (see IItemImageStorage.DeleteItemBlobsAsync). A no-op
    /// (empty result) when the caller's trash is already empty.
    /// </summary>
    Task<IReadOnlyList<long>> EmptyTrashAsync(
        long userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes the caller's oldest trashed Items beyond maxRetained - called after every new
    /// soft-delete to enforce the fixed per-user retention cap (see ItemTrashLimits). Returns the
    /// purged ids for best-effort Blob cleanup. A no-op when the caller's trash is already at or
    /// under maxRetained.
    /// </summary>
    Task<IReadOnlyList<long>> PurgeOldestDeletedBeyondRetentionAsync(
        long userId,
        int maxRetained,
        CancellationToken cancellationToken = default);
}
