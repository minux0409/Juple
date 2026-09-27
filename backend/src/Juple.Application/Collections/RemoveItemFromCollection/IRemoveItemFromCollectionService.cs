namespace Juple.Application.Collections.RemoveItemFromCollection;

public interface IRemoveItemFromCollectionService
{
    Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
