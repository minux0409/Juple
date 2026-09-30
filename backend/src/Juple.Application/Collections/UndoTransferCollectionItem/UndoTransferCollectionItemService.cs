using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.UndoTransferCollectionItem;

public sealed class UndoTransferCollectionItemService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore,
    ISocialNotificationPublisher? notifications = null)
    : IUndoTransferCollectionItemService
{
    public async Task UndoAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        var sourceMembershipRecreated = await collectionManagementStore.UndoTransferItemAsync(
            userId, sourceCollectionId, itemId, targetCollectionId, targetMembershipCreated, cancellationToken);
        // The link is back in the source as a new relation there - the same rule as any other add.
        if (sourceMembershipRecreated && notifications is not null)
        {
            await notifications.CollectionItemsAddedAsync(userId, sourceCollectionId, 1, hideActor: false, cancellationToken);
        }
    }
}
