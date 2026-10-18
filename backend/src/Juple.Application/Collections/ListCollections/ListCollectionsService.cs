namespace Juple.Application.Collections.ListCollections;

public sealed class ListCollectionsService(ICollectionStore collectionStore) : IListCollectionsService
{
    public Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        bool? isFavorite,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default,
        CollectionListSearch? search = null) =>
        collectionStore.ListAsync(userId, itemId, excludeItemId, isFavorite, cursor, limit, search, cancellationToken);

    public Task<CollectionPage> ListByScopeAsync(
        long userId,
        CollectionListScope scope,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default,
        CollectionListSearch? search = null) =>
        collectionStore.ListByScopeAsync(userId, scope, itemId, excludeItemId, cursor, limit, cancellationToken, search);

    public Task<CollectionPage> ListSharedAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default,
        CollectionListSearch? search = null) =>
        collectionStore.ListSharedAsync(userId, itemId, excludeItemId, cursor, limit, cancellationToken, search);
}
