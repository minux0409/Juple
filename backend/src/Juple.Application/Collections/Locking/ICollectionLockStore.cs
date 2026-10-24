namespace Juple.Application.Collections.Locking;

public interface ICollectionLockStore
{
    Task<ICollectionPasswordAttempt> BeginPasswordAttemptAsync(long collectionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Lock state of an active Collection (access must already have been checked), or null. The
    /// hash is its Owner's lock password - or, for an Owner without one, the Collection's legacy
    /// password (see CollectionLockPasswordSource).
    /// </summary>
    Task<CollectionLockState?> GetStateAsync(long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Locks the Collection under its Owner's lock password (no per-Collection password); a no-op when already locked.</summary>
    Task LockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RemoveLockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// The caller's PERSONAL lock on a Collection shared with them (CollectionMemberLock): IsLocked and LockVersion are the member's own, the
    /// hash is the caller's OWN lock password (never the Owner's). Null when the Collection does not exist. Access must already have been checked.
    /// </summary>
    Task<CollectionLockState?> GetMemberStateAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>Locks the Collection for this member only (creates the row or raises its version); a no-op when already locked.</summary>
    Task LockMemberAsync(long userId, long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>Removes this member's own lock (keeps the row, raises the version so older grants die); a no-op when not locked.</summary>
    Task RemoveMemberLockAsync(long userId, long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    Task<DateTimeOffset?> GetBlockedUntilAsync(long collectionId, string subjectKey, int maxFailures, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RecordFailureAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task ResetFailuresAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
