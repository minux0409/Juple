namespace Juple.Application.Collections.Locking;

public interface ICollectionLockService
{
    /// <summary>
    /// Owner only. Locks the Collection under the Owner's lock password (Settings > 컬렉션 잠금);
    /// throws CollectionLockPasswordNotConfiguredException when they have none. No-op when locked.
    /// </summary>
    Task LockAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Owner only. Removes the lock after verifying the password that opens it (no bypass); a no-op when not locked.</summary>
    Task RemoveAsync(long userId, long collectionId, string? currentPassword, CancellationToken cancellationToken = default);

    /// <summary>
    /// A MEMBER (not the Owner, who has the Collection lock above): locks this Collection for this person only, under their own lock password
    /// (Settings > 컬렉션 잠금; CollectionLockPasswordNotConfiguredException when they have none). Nobody else is told or affected - not the Owner, not
    /// other members. It protects the person's own access; it does not leave, hide or change the Collection. No-op when already locked.
    /// </summary>
    Task LockForMemberAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    /// <summary>A member removes their OWN lock after verifying their lock password (no bypass); a no-op when not locked.</summary>
    Task RemoveForMemberAsync(long userId, long collectionId, string? currentPassword, CancellationToken cancellationToken = default);

    /// <summary>Any member (the Owner is not exempt). Returns a short-lived grant bound to this user.</summary>
    Task<CollectionUnlockGrant> UnlockAsync(long userId, long collectionId, string? password, CancellationToken cancellationToken = default);
}
