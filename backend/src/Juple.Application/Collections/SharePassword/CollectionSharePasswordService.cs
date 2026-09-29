using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;

namespace Juple.Application.Collections.SharePassword;

/// <summary>
/// A Collection's share password (see CollectionSharePassword). Managing it is the Owner's alone
/// (ManageShare) and, on a locked Collection, needs the Owner's lock grant first - the lock guards
/// the share password like every other management action. Recipients only ever prove it (UnlockAsync);
/// it is never a permission: access is always checked first, and a correct password without access
/// is the same 404 as a wrong one.
/// </summary>
public sealed class CollectionSharePasswordService(
    ICollectionAccessService accessService,
    ICollectionSharePasswordStore store,
    ICollectionLockPasswordHasher passwordHasher,
    ICollectionSharePasswordProtector protector,
    CollectionPasswordVerifier passwordVerifier,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider) : ICollectionSharePasswordService
{
    public async Task<CollectionSharePasswordStatusDto> GetStatusAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
    {
        await accessService.RequireAsync(userId, collectionId, CollectionPermission.ManageShare, cancellationToken);
        return ToStatus(await store.GetAsync(collectionId, cancellationToken));
    }

    public async Task<CollectionSharePasswordStatusDto> SetAsync(
        long userId,
        long collectionId,
        string? password,
        string? confirmPassword,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageShare, unlockToken, cancellationToken);
        var validPassword = CollectionSharePasswordPolicy.Validate(password);
        if (!string.Equals(validPassword, CollectionSharePasswordPolicy.Normalize(confirmPassword), StringComparison.Ordinal))
        {
            throw new InvalidCollectionException("confirmPassword", "The passwords do not match.");
        }

        await store.SetAsync(
            collectionId,
            passwordHasher.Hash(validPassword),
            protector.Protect(collectionId, validPassword),
            timeProvider.GetUtcNow(),
            cancellationToken);
        return ToStatus(await store.GetAsync(collectionId, cancellationToken));
    }

    public async Task<CollectionSharePasswordStatusDto> RemoveAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageShare, unlockToken, cancellationToken);
        await store.RemoveAsync(collectionId, timeProvider.GetUtcNow(), cancellationToken);
        return ToStatus(await store.GetAsync(collectionId, cancellationToken));
    }

    public async Task<string> RevealAsync(long userId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.ManageShare, unlockToken, cancellationToken);
        var record = await store.GetAsync(collectionId, cancellationToken);
        if (record is not { Mode: CollectionSharePasswordMode.PerCollection, EncryptedPassword: { } encrypted })
        {
            throw new CollectionSharePasswordNotSetException();
        }

        return protector.Unprotect(collectionId, encrypted) ?? throw new CollectionSharePasswordUnreadableException();
    }

    public async Task<CollectionUnlockGrant> UnlockAsync(long userId, long collectionId, string? password, CancellationToken cancellationToken = default)
    {
        // Access first: without a membership this is a plain 404 whether or not the password would
        // have been right - the password never substitutes for access, and never grants any.
        var access = await accessService.RequireAsync(userId, collectionId, CollectionPermission.View, cancellationToken);
        if (access.IsOwner)
        {
            // The Owner is never asked for the share password (their own gate is the lock).
            throw new CollectionSharePasswordNotSetException();
        }

        var record = await store.GetAsync(collectionId, cancellationToken);
        if (record is not { Mode: CollectionSharePasswordMode.PerCollection, PasswordHash: { } passwordHash })
        {
            throw new CollectionSharePasswordNotSetException();
        }

        var nowUtc = timeProvider.GetUtcNow();
        await passwordVerifier.VerifyAsync(
            new CollectionLockState(collectionId, IsLocked: true, passwordHash, record.PasswordVersion),
            CollectionUnlockBuckets.ForSharePasswordUser(userId),
            CollectionSharePasswordPolicy.Normalize(password),
            nowUtc,
            cancellationToken);
        return unlockTokenProtector.Issue(
            collectionId, CollectionUnlockSubject.ForUser(userId), record.PasswordVersion, nowUtc, CollectionUnlockPurpose.SharePassword);
    }

    private static CollectionSharePasswordStatusDto ToStatus(CollectionSharePasswordRecord? record)
    {
        var mode = record?.Mode ?? CollectionSharePasswordMode.None;
        return new CollectionSharePasswordStatusDto(
            CollectionSharePasswordModes.ToWire(mode),
            IsEnabled: mode != CollectionSharePasswordMode.None,
            UpdatedAtUtc: mode == CollectionSharePasswordMode.None ? null : record?.UpdatedAtUtc);
    }
}
