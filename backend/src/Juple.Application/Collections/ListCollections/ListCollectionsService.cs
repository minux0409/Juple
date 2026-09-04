namespace Juple.Application.Collections.ListCollections;

public sealed class ListCollectionsService(ICollectionStore collectionStore) : IListCollectionsService
{
    public Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        collectionStore.ListAsync(userId, itemId, excludeItemId, cursor, limit, cancellationToken);
}
