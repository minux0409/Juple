using Juple.Application.Collections;
using Juple.Application.Collections.Locking;

namespace Juple.Application.Collections.Public;

public sealed class PublicCollectionService(
    IPublicCollectionShareStore publicCollectionShareStore,
    ICollectionLockStore lockStore,
    CollectionPasswordVerifier passwordVerifier,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider)
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

        return IsUnlocked(state, unlockToken)
            ? new PublicCollectionDto(state.Name, state.IsLocked, PublicSharePermissions.ToWire(state.Permission))
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

        var lockState = await lockStore.GetStateAsync(share.CollectionId, cancellationToken);
        if (lockState is null)
        {
            return null;
        }

        if (!lockState.IsLocked)
        {
            throw new CollectionNotLockedException();
        }

        var nowUtc = timeProvider.GetUtcNow();
        await passwordVerifier.VerifyAsync(
            lockState, CollectionUnlockBuckets.ForPublicShare(share.ShareId, clientAttemptId), password, nowUtc, cancellationToken);
        return unlockTokenProtector.Issue(
            share.CollectionId, CollectionUnlockSubject.ForPublicShare(share.ShareId), lockState.LockVersion, nowUtc);
    }

    private bool IsUnlocked(PublicShareState state, string? unlockToken) =>
        !state.IsLocked
        || unlockTokenProtector.IsValid(
            unlockToken,
            state.CollectionId,
            CollectionUnlockSubject.ForPublicShare(state.ShareId),
            state.LockVersion,
            timeProvider.GetUtcNow());
}
