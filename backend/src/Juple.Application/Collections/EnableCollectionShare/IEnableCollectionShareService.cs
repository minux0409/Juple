using Juple.Domain.Collections;

namespace Juple.Application.Collections.EnableCollectionShare;

public interface IEnableCollectionShareService
{
    /// <summary>Idempotent: an existing active share is returned unchanged (its permission included).</summary>
    Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission = CollectionSharePermission.Read,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Null when there is no active share to change. raiseLowerRoles raises every member/pending
    /// invitation below the new permission's minimum role to it, atomically with the change.
    /// </summary>
    Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        CollectionSharePermission permission,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default);
}
