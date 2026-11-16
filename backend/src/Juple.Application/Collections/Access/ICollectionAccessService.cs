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
    /// The permission AND the content gate for who the caller is - required for every operation on
    /// the Collection's content (reading links, adding/removing links, reordering, transfer/merge) and
    /// for managing it: the Owner needs a lock grant for a locked Collection (CollectionLockedException);
    /// a recipient needs a share-password grant when the Collection has its own share password
    /// (CollectionSharePasswordRequiredException), and a lock grant only on a legacy Collection that
    /// is locked. unlockToken may carry several grants separated by commas (an operation spanning two
    /// Collections sends one for each).
    /// </summary>
    Task<CollectionAccess> RequireUnlockedAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        string? unlockToken,
        CancellationToken cancellationToken = default);

    /// <summary>View permission AND the same content gate as RequireUnlockedAsync.</summary>
    Task<CollectionAccess> RequireContentAsync(
        long userId,
        long collectionId,
        string? unlockToken,
        CancellationToken cancellationToken = default);
}
