namespace Juple.Application.Collections.RemoveItemFromCollection;

public sealed class RemoveItemFromCollectionService(
    ICollectionItemStore collectionItemStore) : IRemoveItemFromCollectionService
{
    public Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default) =>
        collectionItemStore.RemoveAsync(userId, collectionId, itemId, cancellationToken);
}
