using System.Linq.Expressions;
using Juple.Application.Notifications.Inbox;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// The recipient's Notification Inbox. Every query is scoped to the authenticated recipient's own
/// UserId (an id of anyone else's notification is simply not found). A page costs a fixed number of
/// set queries whatever its size - the rows, then the facts their targets depend on (Collections,
/// the recipient's memberships, actors, public links, own links, pending invitations), each one query
/// over the whole page, and only the ones the page's Types need - never one per row.
///
/// The Inbox Types are always written as SQL literals (EF.Constant), so SQL Server can match the
/// filtered indexes IX_Notifications_Inbox / IX_Notifications_Unread, whose predicate is the same set.
/// </summary>
public sealed class NotificationInboxStore(JupleDbContext dbContext) : INotificationInboxStore
{
    private static readonly Expression<Func<Notification, bool>> IsInboxRow =
        notification => EF.Constant(NotificationInboxPolicy.InboxTypes).Contains(notification.Type);

    public async Task<IReadOnlyList<NotificationInboxRecord>> ListAsync(
        long userId, long? beforeId, int take, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var query = dbContext.Notifications.AsNoTracking()
            .Where(notification => notification.UserId == userId)
            .Where(IsInboxRow);
        if (beforeId is { } cursor)
        {
            query = query.Where(notification => notification.Id < cursor);
        }

        var rows = await Project(query.OrderByDescending(notification => notification.Id).Take(take)).ToListAsync(cancellationToken);
        return await WithFactsAsync(userId, rows, nowUtc, cancellationToken);
    }

    public async Task<NotificationInboxRecord?> GetAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var rows = await Project(dbContext.Notifications.AsNoTracking()
                .Where(notification => notification.Id == notificationId && notification.UserId == userId)
                .Where(IsInboxRow))
            .ToListAsync(cancellationToken);
        return rows.Count == 0 ? null : (await WithFactsAsync(userId, rows, nowUtc, cancellationToken))[0];
    }

    public Task<int> CountUnreadAsync(long userId, CancellationToken cancellationToken = default) =>
        dbContext.Notifications
            .Where(notification => notification.UserId == userId && notification.ReadAtUtc == null)
            .Where(IsInboxRow)
            .CountAsync(cancellationToken);

    public async Task<bool> DeleteAsync(long userId, long notificationId, CancellationToken cancellationToken = default) =>
        await dbContext.Notifications
            .Where(notification => notification.Id == notificationId && notification.UserId == userId)
            .Where(IsInboxRow)
            .ExecuteDeleteAsync(cancellationToken) > 0;

    public async Task<bool> MarkReadAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var marked = await dbContext.Notifications
            .Where(notification => notification.Id == notificationId && notification.UserId == userId && notification.ReadAtUtc == null)
            .Where(IsInboxRow)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.ReadAtUtc, nowUtc), cancellationToken);
        if (marked > 0)
        {
            return true;
        }

        // Already read (idempotent success) - or not the caller's own Inbox row at all.
        return await dbContext.Notifications
            .Where(notification => notification.Id == notificationId && notification.UserId == userId)
            .Where(IsInboxRow)
            .AnyAsync(cancellationToken);
    }

    public Task<int> MarkAllReadAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        dbContext.Notifications
            .Where(notification => notification.UserId == userId && notification.ReadAtUtc == null)
            .Where(IsInboxRow)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.ReadAtUtc, nowUtc), cancellationToken);

    public Task<int> MarkCollectionReadAsync(
        long userId, long collectionId, NotificationType type, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        dbContext.Notifications
            .Where(notification => notification.UserId == userId
                && notification.ReadAtUtc == null
                && notification.Type == type
                && notification.CollectionId == collectionId)
            .Where(IsInboxRow)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.ReadAtUtc, nowUtc), cancellationToken);

    private static IQueryable<InboxRow> Project(IQueryable<Notification> query) =>
        query.Select(notification => new InboxRow(
            notification.Id,
            notification.Type,
            notification.CreatedAtUtc,
            notification.ReadAtUtc,
            notification.ItemCount,
            notification.ActorUserId,
            notification.CollectionId,
            notification.SubjectId,
            notification.ItemId));

    private async Task<IReadOnlyList<NotificationInboxRecord>> WithFactsAsync(
        long userId, IReadOnlyList<InboxRow> rows, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        if (rows.Count == 0)
        {
            return [];
        }

        List<long> SubjectsOf(params NotificationType[] types) => rows
            .Where(row => types.Contains(row.Type) && row.SubjectId is not null)
            .Select(row => row.SubjectId!.Value)
            .Distinct()
            .ToList();

        var collectionIds = rows.Where(row => row.CollectionId is not null).Select(row => row.CollectionId!.Value).Distinct().ToList();
        var collections = collectionIds.Count == 0
            ? []
            : await dbContext.Collections.AsNoTracking()
                .Where(collection => collectionIds.Contains(collection.Id) && collection.DeletedAtUtc == null)
                .Select(collection => new { collection.Id, collection.Name, collection.UserId, collection.IconImageBlobName })
                .ToDictionaryAsync(collection => collection.Id, cancellationToken);
        var liveIds = collections.Keys.ToList();
        var memberOf = liveIds.Count == 0
            ? []
            : (await dbContext.CollectionCollaborators.AsNoTracking()
                .Where(collaborator => liveIds.Contains(collaborator.CollectionId) && collaborator.UserId == userId)
                .Select(collaborator => collaborator.CollectionId)
                .ToListAsync(cancellationToken))
                .ToHashSet();

        var actorIds = rows
            .Where(row => row.ActorUserId is not null && NotificationInboxPolicy.ShowsActor(row.Type))
            .Select(row => row.ActorUserId!.Value)
            .Distinct()
            .ToList();
        var actors = actorIds.Count == 0
            ? []
            : await dbContext.Users.AsNoTracking()
                .Where(user => actorIds.Contains(user.Id))
                .Select(user => new NotificationInboxActor(user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName))
                .ToDictionaryAsync(actor => actor.UserId, cancellationToken);

        // The public link as it is now - a passed-on link, or a proposal's result for a non-member.
        var shareCollectionIds = rows
            .Where(row => row.CollectionId is { } id && collections.ContainsKey(id)
                && row.Type is NotificationType.CollectionLinkShared
                    or NotificationType.CollectionLinkSubmissionApproved
                    or NotificationType.CollectionLinkSubmissionRejected
                    or NotificationType.JoinRequestRejected)
            .Select(row => row.CollectionId!.Value)
            .Distinct()
            .ToList();
        var linkRows = shareCollectionIds.Count == 0
            ? []
            : (await dbContext.CollectionShares.AsNoTracking()
                .Where(share => shareCollectionIds.Contains(share.CollectionId) && share.IsActive)
                .Select(share => new { share.CollectionId, share.PublicId, share.IsPublic })
                .ToListAsync(cancellationToken))
                .GroupBy(share => share.CollectionId)
                .Select(group => group.First())
                .ToList();
        // The link with public contents (a passed-on link, a proposal result) versus any link (a declined join request lands on the private link).
        var activeShares = linkRows.Where(row => row.IsPublic).ToDictionary(row => row.CollectionId, row => row.PublicId);
        var anyLinks = linkRows.ToDictionary(row => row.CollectionId, row => row.PublicId);

        // A reaction/comment: the link is still in that Collection and still the recipient's own live Item.
        var linkItemIds = SubjectsOf(NotificationType.CollectionItemReactionReceived, NotificationType.CollectionItemCommentReceived);
        var ownLinks = linkItemIds.Count == 0 || liveIds.Count == 0
            ? []
            : (await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    where liveIds.Contains(membership.CollectionId) && linkItemIds.Contains(membership.ItemId)
                    join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                    where item.DeletedAtUtc == null && item.UserId == userId
                    select new { membership.CollectionId, membership.ItemId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.ItemId))
                .ToHashSet();

        // A reply / heart: the link is still in that Collection (live Item) and the comment still exists there - set-based, once per page.
        var threadRows = rows
            .Where(row => row.Type is NotificationType.CommentReplyReceived or NotificationType.CommentLikeReceived
                && row.CollectionId is not null && row.ItemId is not null && row.SubjectId is not null)
            .ToList();
        var threadItemIds = threadRows.Select(row => row.ItemId!.Value).Distinct().ToList();
        var threadCommentIds = threadRows.Select(row => row.SubjectId!.Value).Distinct().ToList();
        var linksInCollection = threadRows.Count == 0 || liveIds.Count == 0
            ? []
            : (await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    where liveIds.Contains(membership.CollectionId) && threadItemIds.Contains(membership.ItemId)
                    join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                    where item.DeletedAtUtc == null
                    select new { membership.CollectionId, membership.ItemId, IsOwn = item.UserId == userId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.ItemId, entry.IsOwn))
                .ToHashSet();
        var liveComments = threadRows.Count == 0
            ? []
            : (await dbContext.CollectionItemComments.AsNoTracking()
                .Where(comment => threadCommentIds.Contains(comment.Id) && comment.DeletedAtUtc == null)
                .Select(comment => new { comment.Id, comment.CollectionId, comment.ItemId, comment.RootCommentId })
                .ToListAsync(cancellationToken))
                .ToDictionary(entry => (entry.Id, entry.CollectionId, entry.ItemId), entry => entry.RootCommentId ?? entry.Id);

        // The thumbnail of the recipient's OWN link a row is about - the stored preview image, one query for
        // the page: the Item a reaction/comment is on (its SubjectId) or a proposal's result is about (ItemId).
        var previewItemIds = rows
            .Select(row => row.Type is NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived
                ? row.SubjectId
                : row.Type is NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected
                    ? row.ItemId
                    : null)
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();
        var previews = previewItemIds.Count == 0
            ? []
            : await dbContext.Items.AsNoTracking()
                .Where(item => previewItemIds.Contains(item.Id) && item.UserId == userId && item.DeletedAtUtc == null && item.PreviewImageUrl != null)
                .Select(item => new { item.Id, item.PreviewImageUrl })
                .ToDictionaryAsync(item => item.Id, item => item.PreviewImageUrl!, cancellationToken);

        var invitationIds = SubjectsOf(NotificationType.CollectionInvitationReceived);
        var pendingInvitations = invitationIds.Count == 0
            ? []
            : (await dbContext.CollectionInvitations.AsNoTracking()
                .Where(invitation => invitationIds.Contains(invitation.Id)
                    && invitation.InvitedUserId == userId
                    && invitation.Status == CollectionInvitationStatus.Pending
                    && invitation.ExpiresAtUtc > nowUtc)
                .Select(invitation => invitation.Id)
                .ToListAsync(cancellationToken))
                .ToHashSet();

        return rows.Select(row =>
        {
            var live = row.CollectionId is { } collectionId && collections.ContainsKey(collectionId);
            var isOwner = live && collections[row.CollectionId!.Value].UserId == userId;
            var belongs = isOwner || (live && memberOf.Contains(row.CollectionId!.Value));
            var invitationPending = row.Type == NotificationType.CollectionInvitationReceived
                && row.SubjectId is { } invitationId && pendingInvitations.Contains(invitationId);
            var publicShareId = live ? (row.Type is NotificationType.JoinRequestRejected or NotificationType.CollectionLinkShared ? anyLinks : activeShares).GetValueOrDefault(row.CollectionId!.Value) : null;
            // The name only where the recipient may still see it: they belong, the invitation still
            // waits for them, or the Collection's public link is on.
            var nameVisible = belongs || (live && (invitationPending || publicShareId is not null));
            return new NotificationInboxRecord(
                row.Id,
                row.Type,
                row.CreatedAtUtc,
                row.ReadAtUtc,
                row.ItemCount,
                row.CollectionId,
                row.SubjectId,
                ActorHidden: row.ActorUserId is null,
                Actor: row.ActorUserId is { } actorId && NotificationInboxPolicy.ShowsActor(row.Type) ? actors.GetValueOrDefault(actorId) : null,
                CollectionName: nameVisible ? collections[row.CollectionId!.Value].Name : null,
                CollectionLive: live,
                RecipientIsOwner: isOwner,
                RecipientBelongs: belongs,
                PublicShareId: publicShareId,
                LinkStillOwn: live
                    && (row.Type is NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived
                        && row.SubjectId is { } itemId
                        && ownLinks.Contains((row.CollectionId!.Value, itemId))
                        || row.Type is NotificationType.CommentReplyReceived or NotificationType.CommentLikeReceived
                        && row.ItemId is { } ownItemId
                        && linksInCollection.Contains((row.CollectionId!.Value, ownItemId, true))),
                InvitationPending: invitationPending,
                PreviewImageUrl: PreviewItemId(row) is { } previewItemId ? previews.GetValueOrDefault(previewItemId) : null,
                CollectionIconBlobName: nameVisible ? collections[row.CollectionId!.Value].IconImageBlobName : null,
                CollectionOwnerUserId: nameVisible ? collections[row.CollectionId!.Value].UserId : 0,
                ItemId: row.ItemId,
                LinkInCollection: live && row.ItemId is { } threadItemId
                    && (linksInCollection.Contains((row.CollectionId!.Value, threadItemId, true)) || linksInCollection.Contains((row.CollectionId!.Value, threadItemId, false))),
                CommentLive: live && row.SubjectId is { } threadCommentId && row.ItemId is { } commentItemId
                    && liveComments.ContainsKey((threadCommentId, row.CollectionId!.Value, commentItemId)),
                ThreadRootCommentId: live && row.SubjectId is { } rootOfCommentId && row.ItemId is { } rootItemId
                    && liveComments.TryGetValue((rootOfCommentId, row.CollectionId!.Value, rootItemId), out var threadRoot) ? threadRoot : null);
        }).ToList();

        static long? PreviewItemId(InboxRow row) =>
            row.Type is NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived
                ? row.SubjectId
                : row.Type is NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected
                    ? row.ItemId
                    : null;
    }

    private sealed record InboxRow(
        long Id,
        NotificationType Type,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset? ReadAtUtc,
        int? ItemCount,
        long? ActorUserId,
        long? CollectionId,
        long? SubjectId,
        long? ItemId);
}
