namespace Juple.Application.Collections.MoveCollectionItem;

public sealed class MoveCollectionItemService(
    ICollectionItemStore collectionItemStore) : IMoveCollectionItemService
{
    public Task MoveAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        CancellationToken cancellationToken = default) =>
        collectionItemStore.MoveItemAsync(userId, collectionId, itemId, afterItemId, cancellationToken);
}
