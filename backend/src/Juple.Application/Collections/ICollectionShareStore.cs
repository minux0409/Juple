namespace Juple.Application.Collections;

public interface ICollectionShareStore
{
    /// <summary>
    /// Idempotent - if an active share already exists for this Collection, returns it unchanged
    /// rather than minting a second one (see UX_CollectionShares_CollectionId_Active). Throws
    /// CollectionNotFoundException for a missing or other-user's Collection, same as
    /// Rename/SetFavorite - unlike Collection.DeleteAsync's tolerant convention, share management
    /// is an ownership boundary, not a pure idempotent-delete operation.
    /// </summary>
    /// <summary>
    /// candidatePublicId is used only if no active share already exists for this Collection - the
    /// caller (see EnableCollectionShareService) generates it upfront so the Store stays a pure
    /// persistence layer with no random-generation logic of its own, mirroring
    /// CreateCollectionService normalizing the Name before calling CreateAsync.
    /// </summary>
    Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        string candidatePublicId,
        DateTimeOffset enabledAtUtc,
        Juple.Domain.Collections.CollectionSharePermission permission = Juple.Domain.Collections.CollectionSharePermission.Read,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Changes what the active public link allows (Read / Write). Null when the Collection is owned
    /// but has no active share. CollectionNotFoundException for a missing or other-user's Collection.
    /// raiseLowerRoles: instead of refusing while a member or pending invitation is below the new
    /// permission's minimum role (publicSharePermissionMismatch), raise exactly those roles to the
    /// minimum in the same transaction as the permission change - all or nothing.
    /// </summary>
    Task<CollectionShareDto?> SetPermissionAsync(
        long userId,
        long collectionId,
        Juple.Domain.Collections.CollectionSharePermission permission,
        DateTimeOffset updatedAtUtc,
        bool raiseLowerRoles = false,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Returns null when the Collection is owned but currently has no active share - that is a
    /// valid state, not an error. Throws CollectionNotFoundException for a missing or
    /// other-user's Collection.
    /// </summary>
    Task<CollectionShareDto?> GetActiveAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent when the Collection is owned but already unshared (no-op success). Throws
    /// CollectionNotFoundException for a missing or other-user's Collection.
    /// </summary>
    Task RevokeAsync(
        long userId,
        long collectionId,
        DateTimeOffset revokedAtUtc,
        CancellationToken cancellationToken = default);
}
