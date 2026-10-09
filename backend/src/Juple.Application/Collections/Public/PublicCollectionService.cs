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
    ICollectionSharePasswordStore? sharePasswordStore = null,
    Juple.Application.Collections.SetCollectionIconImage.ICollectionIconImageStorage? iconImageStorage = null)
    : IPublicCollectionService
{
    public async Task<PublicCollectionDto?> GetCollectionAsync(
        string publicId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        // Any active link: a private one answers too (with its name only, after any password) so the app can offer a join request.
        var state = await publicCollectionShareStore.GetLinkStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        // IsLocked on the wire: a password stands before this link's content (whichever one).
        var isProtected = PublicShareGate.RequirementOf(state) != PublicShareRequirement.None;
        if (!IsUnlocked(state, unlockToken))
        {
            return new PublicCollectionDto(Name: null, IsLocked: true);
        }

        // The Collection's own photo (when it has one) signed for its Owner's prefix - the same mechanism and version as the Collection list.
        string? iconImageUrl = null;
        string? iconImageVersion = null;
        if (iconImageStorage is not null && state.IconImageBlobName is not null)
        {
            var signed = await iconImageStorage.CreateCollectionIconReadUrlAsync(state.OwnerUserId, state.IconImageBlobName, cancellationToken);
            if (signed is not null)
            {
                iconImageUrl = signed.ToString();
                iconImageVersion = Juple.Application.Collections.SetCollectionIconImage.CollectionIconImageVersion.From(state.IconImageBlobName);
            }
        }

        return state.IsPublic
            ? new PublicCollectionDto(state.Name, isProtected, PublicSharePermissions.ToWire(state.Permission), Icon: state.Icon, Color: state.Color, IconImageUrl: iconImageUrl, IconImageVersion: iconImageVersion)
            : new PublicCollectionDto(state.Name, isProtected, Permission: null, IsPublic: false, Icon: state.Icon, Color: state.Color, IconImageUrl: iconImageUrl, IconImageVersion: iconImageVersion);
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
        // Private links have a password gate too (the join-request landing needs it proven first).
        var share = await publicCollectionShareStore.GetLinkStateAsync(publicId, cancellationToken);
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
