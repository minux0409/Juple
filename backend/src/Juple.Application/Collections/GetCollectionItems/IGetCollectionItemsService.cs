namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemsService
{
    /// <summary>Throws CollectionNotFoundException when collectionId is missing or not owned by userId.</summary>
    Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
