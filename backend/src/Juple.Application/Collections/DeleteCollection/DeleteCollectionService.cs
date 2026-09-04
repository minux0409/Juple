namespace Juple.Application.Collections.DeleteCollection;

public sealed class DeleteCollectionService(ICollectionStore collectionStore) : IDeleteCollectionService
{
    public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        collectionStore.DeleteAsync(userId, collectionId, cancellationToken);
}
