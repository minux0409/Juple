namespace Juple.Application.Collections.UndoMergeCollections;

public sealed class UndoMergeCollectionsService(ICollectionManagementStore collectionManagementStore)
    : IUndoMergeCollectionsService
{
    public Task UndoAsync(long userId, Guid undoOperationId, CancellationToken cancellationToken = default) =>
        collectionManagementStore.UndoMergeAsync(userId, undoOperationId, cancellationToken);
}
