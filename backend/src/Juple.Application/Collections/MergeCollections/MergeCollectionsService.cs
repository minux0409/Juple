using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.MergeCollections;

/// <summary>Merging moves every link of the source into the target: both must be unlocked if locked.</summary>
public sealed class MergeCollectionsService(
    ICollectionAccessService accessService,
    ICollectionManagementStore collectionManagementStore)
    : IMergeCollectionsService
{
    public async Task<MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, sourceCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await accessService.RequireUnlockedAsync(userId, targetCollectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        return await collectionManagementStore.MergeAsync(userId, sourceCollectionId, targetCollectionId, cancellationToken);
    }
}
