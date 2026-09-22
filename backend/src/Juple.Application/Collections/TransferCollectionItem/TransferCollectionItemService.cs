namespace Juple.Application.Collections.TransferCollectionItem;

public sealed class TransferCollectionItemService(ICollectionManagementStore collectionManagementStore)
    : ITransferCollectionItemService
{
    public Task<TransferCollectionItemResult> TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default) =>
        collectionManagementStore.TransferItemAsync(userId, sourceCollectionId, itemId, targetCollectionId, cancellationToken);
}
