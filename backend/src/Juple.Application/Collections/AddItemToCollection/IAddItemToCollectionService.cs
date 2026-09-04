namespace Juple.Application.Collections.AddItemToCollection;

public interface IAddItemToCollectionService
{
    Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default);
}
