namespace Juple.Application.Collections.ListCollections;

public interface IListCollectionsService
{
    Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        bool? isFavorite,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
