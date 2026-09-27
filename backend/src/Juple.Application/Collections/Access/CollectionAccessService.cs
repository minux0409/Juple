using Juple.Application.Collections.Locking;

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

    public async Task<CollectionAccess> RequireUnlockedAsync(
        long userId,
        long collectionId,
        CollectionPermission permission,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        var access = await RequireAsync(userId, collectionId, permission, cancellationToken);
        if (!access.IsLocked)
        {
            return access;
        }

        var subject = CollectionUnlockSubject.ForUser(userId);
        var nowUtc = timeProvider.GetUtcNow();
        var hasValidGrant = (unlockToken ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(MaxGrantsPerRequest)
            .Any(token => unlockTokenProtector.IsValid(token, collectionId, subject, access.LockVersion, nowUtc));
        if (!hasValidGrant)
        {
            throw new CollectionLockedException();
        }

        return access;
    }

    // An operation spans at most two Collections; anything beyond a few grants is ignored.
    private const int MaxGrantsPerRequest = 4;
}
