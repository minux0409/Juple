using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.Locking;

public sealed class CollectionLockService(
    ICollectionAccessService accessService,
    ICollectionLockStore lockStore,
    ICollectionLockSettingsStore settingsStore,
    CollectionPasswordVerifier passwordVerifier,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider) : ICollectionLockService
{
    public async Task LockAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageLock, cancellationToken);
        var state = await lockStore.GetStateAsync(collectionId, cancellationToken) ?? throw new CollectionNotFoundException();
        if (state.IsLocked)
        {
            return;
        }

        // ManageLock is Owner-only, so userId is the Owner: the Collection will open with their lock
        // password - never with a password of its own, and never before they have one.
        if (!(await settingsStore.GetStatusAsync(userId, cancellationToken)).IsConfigured)
        {
            throw new CollectionLockPasswordNotConfiguredException();
        }

        await lockStore.LockAsync(collectionId, timeProvider.GetUtcNow(), cancellationToken);
    }

    public async Task RemoveAsync(
        long userId,
        long collectionId,
        string? currentPassword,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageLock, cancellationToken);
        var nowUtc = timeProvider.GetUtcNow();

        var state = await lockStore.GetStateAsync(collectionId, cancellationToken) ?? throw new CollectionNotFoundException();
        if (!state.IsLocked)
        {
            return;
        }

        await passwordVerifier.VerifyAsync(
            state, CollectionUnlockSubject.ForUser(userId), currentPassword, nowUtc, cancellationToken);
        await lockStore.RemoveLockAsync(collectionId, nowUtc, cancellationToken);
    }

    public async Task<CollectionUnlockGrant> UnlockAsync(
        long userId,
        long collectionId,
        string? password,
        CancellationToken cancellationToken = default)
    {
        // Access first: without a membership this is a plain 404 whether or not the password would
        // have been right - the password never substitutes for access.
        var access = await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);

        // The lock password is the Owner's own: a recipient is never asked for it (their gate is the
        // Collection's share password) and so may never test it here either - except a legacy
        // Collection, whose recipients still open it with that password (see CollectionSharePasswordMode).
        if (!access.IsOwner && access.SharePasswordMode != Juple.Domain.Collections.CollectionSharePasswordMode.LegacyCommonLock)
        {
            throw new CollectionNotLockedException();
        }
        var nowUtc = timeProvider.GetUtcNow();

        var state = await lockStore.GetStateAsync(collectionId, cancellationToken) ?? throw new CollectionNotFoundException();
        if (!state.IsLocked)
        {
            throw new CollectionNotLockedException();
        }

        var subject = CollectionUnlockSubject.ForUser(userId);
        await passwordVerifier.VerifyAsync(state, subject, password, nowUtc, cancellationToken);
        return unlockTokenProtector.Issue(collectionId, subject, state.LockVersion, nowUtc);
    }
}
