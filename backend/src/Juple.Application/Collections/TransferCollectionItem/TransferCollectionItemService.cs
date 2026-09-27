using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.TransferCollectionItem;

/// <summary>Both Collections must be the caller's and, if locked, unlocked (collaborative ones are refused by the store).</summary>
public sealed class TransferCollectionItemService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore)
    : ITransferCollectionItemService
{
    public async Task<TransferCollectionItemResult> TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        return await collectionManagementStore.TransferItemAsync(userId, sourceCollectionId, itemId, targetCollectionId, cancellationToken);
    }
}
