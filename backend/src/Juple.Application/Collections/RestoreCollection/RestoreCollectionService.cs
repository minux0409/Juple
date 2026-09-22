namespace Juple.Application.Collections.RestoreCollection;

public sealed class RestoreCollectionService(ICollectionStore collectionStore) : IRestoreCollectionService
{
    public Task RestoreAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        collectionStore.RestoreAsync(userId, collectionId, cancellationToken);
}
