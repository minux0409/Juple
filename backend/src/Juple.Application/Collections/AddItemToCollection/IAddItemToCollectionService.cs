namespace Juple.Application.Collections.AddItemToCollection;

public interface IAddItemToCollectionService
{
    Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
