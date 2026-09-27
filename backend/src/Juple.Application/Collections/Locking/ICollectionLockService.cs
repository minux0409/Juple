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

    /// <summary>Any member (the Owner is not exempt). Returns a short-lived grant bound to this user.</summary>
    Task<CollectionUnlockGrant> UnlockAsync(long userId, long collectionId, string? password, CancellationToken cancellationToken = default);
}
