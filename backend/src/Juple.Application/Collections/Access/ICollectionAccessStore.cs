namespace Juple.Application.Collections.Access;

public interface ICollectionAccessStore
{
    /// <summary>The caller's access to an active (not soft-deleted) Collection, or null when they have none.</summary>
    Task<CollectionAccess?> FindAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
