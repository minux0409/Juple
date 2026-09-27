using Juple.Domain.Collections;

namespace Juple.Application.Collections.EnableCollectionShare;

public sealed class EnableCollectionShareService(
    ICollectionShareStore collectionShareStore,
    TimeProvider timeProvider) : IEnableCollectionShareService
{
    public Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission = CollectionSharePermission.Read,
        CancellationToken cancellationToken = default)
    {
        RequireKnown(permission);
        return collectionShareStore.EnableAsync(
            userId, collectionId, CollectionSharePublicIdGenerator.Generate(), timeProvider.GetUtcNow(), permission, cancellationToken);
    }

    public Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission,
        CancellationToken cancellationToken = default)
    {
        RequireKnown(permission);
        return collectionShareStore.SetPermissionAsync(userId, collectionId, permission, timeProvider.GetUtcNow(), cancellationToken);
    }

    private static void RequireKnown(CollectionSharePermission permission)
    {
        if (!Enum.IsDefined(permission))
        {
            throw new InvalidCollectionException("permission", "Unknown permission.");
        }
    }
}
