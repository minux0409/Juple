namespace Juple.Application.Collections.UndoTransferCollectionItem;

public sealed class UndoTransferCollectionItemService(ICollectionManagementStore collectionManagementStore)
    : IUndoTransferCollectionItemService
{
    public Task UndoAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, CancellationToken cancellationToken = default) =>
        collectionManagementStore.UndoTransferItemAsync(
            userId, sourceCollectionId, itemId, targetCollectionId, targetMembershipCreated, cancellationToken);
}
