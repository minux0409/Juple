namespace Juple.Application.Collections.Locking;

public interface ICollectionLockStore
{
    /// <summary>
    /// Lock state of an active Collection (access must already have been checked), or null. The
    /// hash is its Owner's lock password - or, for an Owner without one, the Collection's legacy
    /// password (see CollectionLockPasswordSource).
    /// </summary>
    Task<CollectionLockState?> GetStateAsync(long collectionId, CancellationToken cancellationToken = default);

    /// <summary>Locks the Collection under its Owner's lock password (no per-Collection password); a no-op when already locked.</summary>
    Task LockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RemoveLockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<DateTimeOffset?> GetBlockedUntilAsync(long collectionId, string subjectKey, int maxFailures, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RecordFailureAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task ResetFailuresAsync(long collectionId, string subjectKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
