namespace Juple.Application.Collections.GetCollectionShare;

/// <summary>
/// Makes sure a Collection has a link to pass on. New Collections get theirs when they are created; this covers the ones that existed
/// before that and have never had one. The link is PRIVATE (nothing of the Collection is public; a stranger can only ask the Owner to
/// join), so creating it opens nothing by itself. Callers have already checked that the caller may see the Collection.
/// </summary>
public interface ICollectionLinkEnsurer
{
    /// <summary>The active link after the call - null when there is none (a revoked link is not brought back).</summary>
    Task<CollectionShareDto?> EnsureAsync(long collectionId, CancellationToken cancellationToken = default);
}

public sealed class CollectionLinkEnsurer(ICollectionShareStore collectionShareStore, TimeProvider timeProvider) : ICollectionLinkEnsurer
{
    public Task<CollectionShareDto?> EnsureAsync(long collectionId, CancellationToken cancellationToken = default) =>
        collectionShareStore.EnsureInitialPrivateLinkAsync(
            collectionId, CollectionSharePublicIdGenerator.Generate(), timeProvider.GetUtcNow(), cancellationToken);
}
