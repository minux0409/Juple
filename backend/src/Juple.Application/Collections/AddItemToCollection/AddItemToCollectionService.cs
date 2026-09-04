namespace Juple.Application.Collections.AddItemToCollection;

public sealed class AddItemToCollectionService(
    ICollectionItemStore collectionItemStore,
    TimeProvider timeProvider) : IAddItemToCollectionService
{
    public Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default) =>
        collectionItemStore.AddAsync(userId, collectionId, itemId, timeProvider.GetUtcNow(), cancellationToken);
}
