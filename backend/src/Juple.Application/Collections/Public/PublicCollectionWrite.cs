using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Submissions;
using Juple.Application.Notifications;
using Juple.Domain.Collections;

namespace Juple.Application.Collections.Public;

/// <summary>The wire form of CollectionSharePermission ("read" / "write") - the same words in every API.</summary>
public static class PublicSharePermissions
{
    public const string Read = "read";
    public const string Write = "write";
    public const string Submit = "submit";

    public static string ToWire(CollectionSharePermission permission) => permission switch
    {
        CollectionSharePermission.Write => Write,
        CollectionSharePermission.Submit => Submit,
        _ => Read,
    };

    public static bool TryParse(string? value, out CollectionSharePermission permission)
    {
        permission = CollectionSharePermission.Read;
        switch (value?.Trim().ToLowerInvariant())
        {
            case Read:
                return true;
            case Write:
                permission = CollectionSharePermission.Write;
                return true;
            case Submit:
                permission = CollectionSharePermission.Submit;
                return true;
            default:
                return false;
        }
    }
}

/// <summary>The link is read-only: nobody may add through it (403, code publicShareReadOnly).</summary>
public sealed class PublicShareReadOnlyException : Exception
{
}

public interface IPublicCollectionWriteStore
{
    /// <summary>
    /// Adds the caller's own Item through an active, writable public link - re-checked under the
    /// Collection row lock (a concurrent revoke or switch to read-only wins). Records the adder
    /// (AddedByUserId) and marks the membership AddedViaPublicShare. Idempotent for an Item already
    /// in the Collection: true when this call added it, false when it was already there. Null when
    /// the link is unknown/revoked; PublicShareReadOnlyException when
    /// it is not writable; ItemNotFoundException when the Item is not the caller's (or deleted).
    /// </summary>
    Task<bool?> AddItemAsync(
        string publicId,
        long userId,
        long itemId,
        DateTimeOffset addedAtUtc,
        CancellationToken cancellationToken = default);
}

public interface IPublicCollectionWriteService
{
    /// <summary>
    /// A SIGNED-IN user adds one of their own links through a writable public link. Anonymous callers
    /// never reach this (the endpoint requires a Juple user). Being able to add grants nothing else:
    /// no membership, no editing/removing, no management. A locked Collection additionally needs the
    /// public link's unlock grant, exactly like reading it. Returns false for an unknown/revoked link.
    /// </summary>
    /// <summary>Null for an unknown/revoked link; Submitted when the link takes proposals (승인 후 추가) - waiting for the Owner.</summary>
    Task<CollectionLinkAddOutcome?> AddItemAsync(
        long userId,
        string publicId,
        long itemId,
        string? unlockToken,
        CancellationToken cancellationToken = default);
}

public sealed class PublicCollectionWriteService(
    IPublicCollectionShareStore shareStore,
    IPublicCollectionWriteStore writeStore,
    ICollectionUnlockTokenProtector unlockTokenProtector,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null,
    ICollectionLinkSubmissionStore? submissions = null) : IPublicCollectionWriteService
{
    public async Task<CollectionLinkAddOutcome?> AddItemAsync(
        long userId,
        string publicId,
        long itemId,
        string? unlockToken,
        CancellationToken cancellationToken = default)
    {
        var state = await shareStore.GetStateAsync(publicId, cancellationToken);
        if (state is null)
        {
            return null;
        }

        var takesProposals = state.Permission == CollectionSharePermission.Submit && submissions is not null;
        if (state.Permission != CollectionSharePermission.Write && !takesProposals)
        {
            throw new PublicShareReadOnlyException();
        }

        var nowUtc = timeProvider.GetUtcNow();
        if (!PublicShareGate.IsUnlocked(state, unlockToken, unlockTokenProtector, nowUtc))
        {
            throw new CollectionLockedException();
        }

        if (takesProposals)
        {
            // 승인 후 추가: a proposal for the Owner (the store re-checks the link under the lock). Not
            // part of the Collection yet, so the members are not notified - only the Owner, who has a
            // proposal to review (never told by whom). The Owner's own link goes straight in.
            await using var proposalOutbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
            var outcome = await submissions!.SubmitAsync(userId, state.CollectionId, itemId, publicId, nowUtc, cancellationToken);
            if (outcome == CollectionLinkAddOutcome.Added && notifications is not null)
            {
                await notifications.CollectionsChangedAsync(userId, [state.CollectionId], cancellationToken);
                await notifications.CollectionItemsAddedAsync(userId, state.CollectionId, 1, hideActor: false, cancellationToken);
            }
            else if (outcome == CollectionLinkAddOutcome.Submitted && notifications is not null)
            {
                await notifications.CollectionLinkSubmittedAsync(userId, state.CollectionId, itemId, cancellationToken);
            }

            await proposalOutbox.CommitAsync(cancellationToken);
            return outcome;
        }

        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var added = await writeStore.AddItemAsync(publicId, userId, itemId, nowUtc, cancellationToken);
        if (added is null)
        {
            return null;
        }

        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [state.CollectionId], cancellationToken);
            if (added.Value)
            {
                // Added through the public link: whoever added it is never named to the members.
                await notifications.CollectionItemsAddedAsync(userId, state.CollectionId, 1, hideActor: true, cancellationToken);
            }
        }

        await outbox.CommitAsync(cancellationToken);
        return CollectionLinkAddOutcome.Added;
    }
}
