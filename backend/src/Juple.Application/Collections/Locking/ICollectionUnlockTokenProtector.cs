namespace Juple.Application.Collections.Locking;

/// <summary>
/// Stateless, replica-safe unlock grants: authenticated-encrypted tokens binding (Collection,
/// subject, LockVersion, expiry) under a server-held key. No per-process state - any API replica
/// can validate a grant any other replica issued, and a lock change (LockVersion bump) invalidates
/// all of them at once.
/// </summary>
public interface ICollectionUnlockTokenProtector
{
    CollectionUnlockGrant Issue(long collectionId, CollectionUnlockSubject subject, int lockVersion, DateTimeOffset nowUtc);

    bool IsValid(string? token, long collectionId, CollectionUnlockSubject subject, int lockVersion, DateTimeOffset nowUtc);
}
