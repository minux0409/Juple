using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.UndoTransferCollectionItem;

public sealed class UndoTransferCollectionItemService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore)
    : IUndoTransferCollectionItemService
{
    public async Task UndoAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await collectionManagementStore.UndoTransferItemAsync(
            userId, sourceCollectionId, itemId, targetCollectionId, targetMembershipCreated, cancellationToken);
    }
}
