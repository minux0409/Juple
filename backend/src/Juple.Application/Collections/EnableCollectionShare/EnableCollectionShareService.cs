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
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default)
    {
        RequireKnown(permission);
        return collectionShareStore.EnableAsync(
            userId, collectionId, CollectionSharePublicIdGenerator.Generate(), timeProvider.GetUtcNow(), permission, raiseLowerRoles, cancellationToken);
    }

    public Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default)
    {
        RequireKnown(permission);
        return collectionShareStore.SetPermissionAsync(userId, collectionId, permission, timeProvider.GetUtcNow(), raiseLowerRoles, cancellationToken);
    }

    private static void RequireKnown(CollectionSharePermission permission)
    {
        if (!Enum.IsDefined(permission))
        {
            throw new InvalidCollectionException("permission", "Unknown permission.");
        }
    }
}
