namespace Juple.Application.Collections.MergeCollections;

public sealed class MergeCollectionsService(ICollectionManagementStore collectionManagementStore)
    : IMergeCollectionsService
{
    public Task MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        CancellationToken cancellationToken = default) =>
        collectionManagementStore.MergeAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);
}
