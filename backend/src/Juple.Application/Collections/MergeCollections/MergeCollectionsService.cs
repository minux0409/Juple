using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.MergeCollections;

/// <summary>Merging moves every link of the source into the target: both must be unlocked if locked.</summary>
public sealed class MergeCollectionsService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore,
    ISocialNotificationPublisher? notifications = null)
    : IMergeCollectionsService
{
    public async Task<MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        var result = await collectionManagementStore.MergeAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);
        // One grouped notification for the links this merge actually added to the target (links the
        // target already had are not counted; none added - nobody is told). Same caveat as transfer:
        // the store refuses collaborative Collections for merge today.
        if (result.AddedToTargetCount > 0 && notifications is not null)
        {
            await notifications.CollectionItemsAddedAsync(userId, targetCollectionId, result.AddedToTargetCount, hideActor: false, cancellationToken);
        }

        return result;
    }
}
