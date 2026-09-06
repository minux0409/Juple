namespace Juple.Application.Collections.GetCollectionShare;

public sealed class GetCollectionShareService(ICollectionShareStore collectionShareStore) : IGetCollectionShareService
{
    public Task<CollectionShareDto?> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default) =>
        collectionShareStore.GetActiveAsync(userId, collectionId, cancellationToken);
}
