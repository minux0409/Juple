using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.TransferCollectionItem;

/// <summary>Both Collections must be the caller's and, if locked, unlocked (collaborative ones are refused by the store).</summary>
public sealed class TransferCollectionItemService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore,
    ISocialNotificationPublisher? notifications = null)
    : ITransferCollectionItemService
{
    public async Task<TransferCollectionItemResult> TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        var result = await collectionManagementStore.TransferItemAsync(userId, sourceCollectionId, itemId, targetCollectionId, cancellationToken);
        // Only after the transfer committed, and only for a link that is new in the target. (Today
        // the store refuses collaborative Collections for transfer, so the target's only possible
        // recipient is the Owner - the actor - and nobody is told; the rule is kept regardless.)
        if (result.TargetMembershipCreated && notifications is not null)
        {
            await notifications.CollectionItemsAddedAsync(userId, targetCollectionId, 1, hideActor: false, cancellationToken);
        }

        return result;
    }
}
