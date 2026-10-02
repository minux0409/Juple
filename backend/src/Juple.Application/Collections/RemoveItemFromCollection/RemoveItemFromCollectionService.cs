using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.RemoveItemFromCollection;

/// <summary>
/// 컬렉션에서 제거 - only ever the link (the CollectionItem membership), never the Item itself, which
/// stays in its owner's own library. The Owner may remove any link; a member (Contributor or Viewer,
/// whatever their role is now) only links whose Item is their own - the ones they added. Anyone
/// else - another member's link, a pending invitee, a stranger - is refused. For a locked or
/// share-password-protected Collection a valid grant is needed first, as for every content change.
/// </summary>
public sealed class RemoveItemFromCollectionService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    ISocialNotificationPublisher? notifications = null,
    ICollectionContributedLinkStore? contributedLinks = null) : IRemoveItemFromCollectionService
{
    public async Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        var access = await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.View, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        if (access.IsOwner)
        {
            await collectionItemStore.RemoveAsync(userId, collectionId, itemId, cancellationToken);
        }
        else if (contributedLinks is null
            || await contributedLinks.RemoveOwnLinkAsync(userId, collectionId, itemId, cancellationToken) == ContributedLinkRemoval.NotOwnLink)
        {
            // A member only ever removes their own links.
            throw new CollectionForbiddenException();
        }

        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }
}

public enum ContributedLinkRemoval
{
    Removed,

    /// <summary>The link is not in the Collection (already removed) - the desired end state.</summary>
    Absent,

    /// <summary>The link is there, but its Item belongs to someone else - nothing was removed.</summary>
    NotOwnLink,
}

/// <summary>A member removing a link they added to someone else's Collection - access is checked by the caller.</summary>
public interface ICollectionContributedLinkStore
{
    /// <summary>Removes the membership only when the linked Item is userId's own; the Item itself is never touched.</summary>
    Task<ContributedLinkRemoval> RemoveOwnLinkAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default);
}
