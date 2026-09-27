using Juple.Domain.Collections;

namespace Juple.Application.Collections.EnableCollectionShare;

public interface IEnableCollectionShareService
{
    /// <summary>Idempotent: an existing active share is returned unchanged (its permission included).</summary>
    Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission = CollectionSharePermission.Read,
        CancellationToken cancellationToken = default);

    /// <summary>Null when there is no active share to change.</summary>
    Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission,
        CancellationToken cancellationToken = default);
}
