namespace Juple.Application.Collections.GetCollectionShare;

public sealed class GetCollectionShareService(
    ICollectionShareStore collectionShareStore,
    ICollectionLinkEnsurer? linkEnsurer = null) : IGetCollectionShareService
{
    public async Task<CollectionShareDto?> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default)
    {
        var share = await collectionShareStore.GetActiveAsync(userId, collectionId, cancellationToken);
        if (share is not null || linkEnsurer is null)
        {
            return share;
        }

        // Ownership is proven (GetActiveAsync throws for anyone else). A Collection that existed before links were created with it, and
        // has never had one, gets its first (private) link now; a revoked link stays revoked.
        return await linkEnsurer.EnsureAsync(collectionId, cancellationToken);
    }
}
