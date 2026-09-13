namespace Juple.Application.Collections.MoveCollectionItem;

public interface IMoveCollectionItemService
{
    Task MoveAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        CancellationToken cancellationToken = default);
}
