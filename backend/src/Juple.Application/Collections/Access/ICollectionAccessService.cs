namespace Juple.Application.Collections.Access;

public interface ICollectionAccessService
{
    /// <summary>
    /// Throws CollectionNotFoundException when the caller has no access at all (indistinguishable
    /// from a non-existent id), CollectionForbiddenException when they have access but not this
    /// permission.
    /// </summary>
    Task<CollectionAccess> RequireAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// The permission AND, for a locked Collection, a valid unlock grant for this user and the
    /// Collection's current LockVersion (CollectionLockedException otherwise) - required for every
    /// operation on the Collection's content: reading links, adding/removing links, reordering,
    /// transfer/merge. The Owner is not exempt. unlockToken may carry several grants separated by
    /// commas (an operation spanning two Collections sends one for each).
    /// </summary>
    Task<CollectionAccess> RequireUnlockedAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        string? unlockToken,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// View permission AND, for a locked Collection, a valid unlock grant for this user and the
    /// Collection's current LockVersion - otherwise CollectionLockedException. The Owner is not
    /// exempt from the lock.
    /// </summary>
    Task<CollectionAccess> RequireContentAsync(
        long userId,
        long collectionId,
        string? unlockToken,
        CancellationToken cancellationToken = default);
}
