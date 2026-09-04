namespace Juple.Application.Collections.RemoveItemFromCollection;

public interface IRemoveItemFromCollectionService
{
    Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default);
}
