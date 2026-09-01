namespace Juple.Application.Items;

public interface IItemLifecycleStore
{
    Task MoveToWishlistAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default);

    Task MoveToArchiveAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Hard-deletes the caller's Item if it exists. A missing Item (never existed, owned by
    /// another user, or already deleted) is treated as already reaching the desired absent
    /// state and completes without error - this keeps DELETE idempotent under retry.
    /// </summary>
    Task DeleteAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
