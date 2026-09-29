using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;

namespace Juple.Application.Collections.Access;

public sealed class CollectionAccessService(
    ICollectionAccessStore accessStore,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider) : ICollectionAccessService
{
    public async Task<CollectionAccess> RequireAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        CancellationToken cancellationToken = default)
    {
        var access = await accessStore.FindAsync(userId, collectionId, cancellationToken)
            ?? throw new CollectionNotFoundException();
        if (!access.Allows(permission))
        {
            throw new CollectionForbiddenException();
        }

        return access;
    }

    public Task<CollectionAccess> RequireContentAsync(
        long userId,
        long collectionId,
        string? unlockToken,
        CancellationToken cancellationToken = default) =>
        RequireUnlockedAsync(userId, collectionId, CollectionPermission.View, unlockToken, cancellationToken);

    /// <summary>
    /// The permission, then the content gates for who the caller is - one place for every content
    /// and write path (items, sections, adding/removing/moving links, managing the Collection):
    /// the Owner - only the Collection lock (their lock password), never a share password;
    /// a recipient (Contributor/Viewer) - only the Collection's own share password when it has one,
    /// never the Owner's lock password - except a Collection still in the legacy mode, whose
    /// recipients keep needing the lock grant while it is locked, exactly as before share passwords.
    /// </summary>
    public async Task<CollectionAccess> RequireUnlockedAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        var access = await RequireAsync(userId, collectionId, permission, cancellationToken);
        var subject = CollectionUnlockSubject.ForUser(userId);
        var nowUtc = timeProvider.GetUtcNow();
        bool HasGrant(int version, CollectionUnlockPurpose purpose) =>
            (unlockToken ?? string.Empty)
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Take(MaxGrantsPerRequest)
                .Any(token => unlockTokenProtector.IsValid(token, collectionId, subject, version, nowUtc, purpose));

        if (access.IsOwner)
        {
            if (access.IsLocked && !HasGrant(access.LockVersion, CollectionUnlockPurpose.CollectionLock))
            {
                throw new CollectionLockedException();
            }

            return access;
        }

        switch (access.SharePasswordMode)
        {
            case CollectionSharePasswordMode.PerCollection
                when !HasGrant(access.SharePasswordVersion, CollectionUnlockPurpose.SharePassword):
                throw new CollectionSharePasswordRequiredException();
            case CollectionSharePasswordMode.LegacyCommonLock
                when access.IsLocked && !HasGrant(access.LockVersion, CollectionUnlockPurpose.CollectionLock):
                throw new CollectionLockedException();
        }

        return access;
    }

    // An operation spans at most two Collections; anything beyond a few grants is ignored.
    private const int MaxGrantsPerRequest = 4;
}
