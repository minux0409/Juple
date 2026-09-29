using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.SharePassword;

namespace Juple.Application.Collections.Public;

public sealed class PublicCollectionService(
    IPublicCollectionShareStore publicCollectionShareStore,
    ICollectionLockStore lockStore,
    CollectionPasswordVerifier passwordVerifier,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider,
    ICollectionSharePasswordStore? sharePasswordStore = null)
    : IPublicCollectionService
{
    public async Task<PublicCollectionDto?> GetCollectionAsync(
        string publicId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        var state = await publicCollectionShareStore.GetStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        // IsLocked on the wire: a password stands before this link's content (whichever one).
        var isProtected = PublicShareGate.RequirementOf(state) != PublicShareRequirement.None;
        return IsUnlocked(state, unlockToken)
            ? new PublicCollectionDto(state.Name, isProtected, PublicSharePermissions.ToWire(state.Permission))
            : new PublicCollectionDto(Name: null, IsLocked: true);
    }

    public async Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        var state = await publicCollectionShareStore.GetStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        if (!IsUnlocked(state, unlockToken))
        {
            throw new CollectionLockedException();
        }

        return await publicCollectionShareStore.GetItemsAsync(publicId, cursor, limit, cancellationToken);
    }

    public async Task<CollectionUnlockGrant?> UnlockAsync(
        string publicId,
        string? password,
        string? clientAttemptId = null,
        CancellationToken cancellationToken = default)
    {
        var share = await publicCollectionShareStore.GetStateAsync(publicId, cancellationToken);
        if (share is null)
        {
            return null;
        }

        var nowUtc = timeProvider.GetUtcNow();
        var buckets = CollectionUnlockBuckets.ForPublicShare(share.ShareId, clientAttemptId);
        var subject = CollectionUnlockSubject.ForPublicShare(share.ShareId);
        switch (PublicShareGate.RequirementOf(share))
        {
            case PublicShareRequirement.SharePassword:
            {
                var record = sharePasswordStore is null ? null : await sharePasswordStore.GetAsync(share.CollectionId, cancellationToken);
                if (record is not { Mode: Juple.Domain.Collections.CollectionSharePasswordMode.PerCollection, PasswordHash: { } passwordHash })
                {
                    throw new CollectionNotLockedException();
                }

                await passwordVerifier.VerifyAsync(
                    new CollectionLockState(share.CollectionId, IsLocked: true, passwordHash, record.PasswordVersion),
                    buckets,
                    CollectionSharePasswordPolicy.Normalize(password),
                    nowUtc,
                    cancellationToken);
                return unlockTokenProtector.Issue(
                    share.CollectionId, subject, record.PasswordVersion, nowUtc, CollectionUnlockPurpose.SharePassword);
            }

            case PublicShareRequirement.LockPassword:
            {
                var lockState = await lockStore.GetStateAsync(share.CollectionId, cancellationToken);
                if (lockState is null)
                {
                    return null;
                }

                if (!lockState.IsLocked)
                {
                    throw new CollectionNotLockedException();
                }

                await passwordVerifier.VerifyAsync(lockState, buckets, password, nowUtc, cancellationToken);
                return unlockTokenProtector.Issue(share.CollectionId, subject, lockState.LockVersion, nowUtc);
            }

            default:
                throw new CollectionNotLockedException();
        }
    }

    private bool IsUnlocked(PublicShareState state, string? unlockToken) =>
        PublicShareGate.IsUnlocked(state, unlockToken, unlockTokenProtector, timeProvider.GetUtcNow());
}
