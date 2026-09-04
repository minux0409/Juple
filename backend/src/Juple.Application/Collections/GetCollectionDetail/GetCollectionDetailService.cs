namespace Juple.Application.Collections.GetCollectionDetail;

public sealed class GetCollectionDetailService(ICollectionStore collectionStore) : IGetCollectionDetailService
{
    public Task<CollectionDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        collectionStore.GetAsync(userId, collectionId, cancellationToken);
}
