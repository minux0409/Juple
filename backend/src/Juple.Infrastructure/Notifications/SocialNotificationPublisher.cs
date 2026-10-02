using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// Writes social notifications into the Push outbox (see ISocialNotificationPublisher). Every
/// method is best-effort and never throws: the user's action already committed, and a missing
/// notification only means the app refreshes on its next focus instead. The same event is written
/// at most once (UX_Notifications_DedupKey); content changes are coalesced per recipient, Collection
/// and minute. Logs never include names, links or ids beyond the notification type.
/// </summary>
public sealed class SocialNotificationPublisher(
    JupleDbContext dbContext,
    TimeProvider timeProvider,
    ILogger<SocialNotificationPublisher> logger) : ISocialNotificationPublisher
{
    public Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.FriendRequestReceived, () => EnqueueAsync(
            [Notification.Social(recipientUserId, NotificationType.FriendRequestReceived, requesterUserId, null, friendshipId,
                $"friend-request:{friendshipId}", timeProvider.GetUtcNow())],
            cancellationToken));

    public Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.FriendRequestAnswered, () => EnqueueAsync(
            [Notification.Social(requesterUserId, NotificationType.FriendRequestAnswered, answererUserId, null, friendshipId,
                $"friend-request-answered:{friendshipId}", timeProvider.GetUtcNow())],
            cancellationToken));

    public Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.CollectionInvitationReceived, () => EnqueueAsync(
            [Notification.Social(invitedUserId, NotificationType.CollectionInvitationReceived, ownerUserId, collectionId, invitationId,
                $"collection-invitation:{invitationId}", timeProvider.GetUtcNow())],
            cancellationToken));

    public Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.CollectionInvitationAnswered, async () =>
        {
            var invitation = await dbContext.CollectionInvitations.AsNoTracking()
                .Where(entry => entry.Id == invitationId && entry.InvitedUserId == inviteeUserId)
                .Select(entry => new { entry.CollectionId, entry.InvitedByUserId })
                .FirstOrDefaultAsync(cancellationToken);
            if (invitation is null)
            {
                return;
            }

            await EnqueueAsync(
                [Notification.Social(invitation.InvitedByUserId, NotificationType.CollectionInvitationAnswered, inviteeUserId,
                    invitation.CollectionId, invitationId, $"invitation-answered:{invitationId}", timeProvider.GetUtcNow())],
                cancellationToken);
        });

    public Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.CollectionContentChanged, () => EnqueueContentChangesAsync(actorUserId, collectionIds, cancellationToken));

    public Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.CollectionContentChanged, async () =>
        {
            var collectionIds = await dbContext.CollectionItems.AsNoTracking()
                .Where(entry => entry.ItemId == itemId)
                .Select(entry => entry.CollectionId)
                .Distinct()
                .ToListAsync(cancellationToken);
            await EnqueueContentChangesAsync(actorUserId, collectionIds, cancellationToken);
        });

    public Task CollectionItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, CancellationToken cancellationToken = default) =>
        EnqueueItemsAddedAsync(actorUserId, collectionId, itemCount, hideActor, alsoSkipUserId: null, cancellationToken);

    public Task CollectionLinkApprovedAsync(long ownerUserId, long submitterUserId, long collectionId, bool hideActor, CancellationToken cancellationToken = default) =>
        EnqueueItemsAddedAsync(submitterUserId, collectionId, 1, hideActor, alsoSkipUserId: ownerUserId, cancellationToken);

    public Task CollectionItemReactionReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        EnqueueCollaborationAsync(NotificationType.CollectionItemReactionReceived, actorUserId, collectionId, itemId, cancellationToken);

    public Task CollectionItemCommentReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        EnqueueCollaborationAsync(NotificationType.CollectionItemCommentReceived, actorUserId, collectionId, itemId, cancellationToken);

    public Task CollectionLinkSubmittedAsync(long submitterUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        SafelyAsync(NotificationType.CollectionLinkSubmissionReceived, async () =>
        {
            // The proposal just recorded (one per Collection and link, so at most one waiting row of
            // this Item by this person) and the Owner it waits for.
            var waiting = await (
                    from submission in dbContext.CollectionLinkSubmissions.AsNoTracking()
                    where submission.CollectionId == collectionId && submission.ItemId == itemId && submission.SubmittedByUserId == submitterUserId
                    join collection in dbContext.Collections.AsNoTracking() on submission.CollectionId equals collection.Id
                    where collection.DeletedAtUtc == null
                    orderby submission.Id descending
                    select new { submission.Id, OwnerUserId = collection.UserId })
                .FirstOrDefaultAsync(cancellationToken);
            if (waiting is null || waiting.OwnerUserId == submitterUserId)
            {
                return;
            }

            // No actor: who proposed is never part of this notification (a proposal through the
            // public link must stay anonymous, and the Owner sees members' names in 승인 대기 anyway).
            await EnqueueAsync(
                [Notification.Social(waiting.OwnerUserId, NotificationType.CollectionLinkSubmissionReceived, null, collectionId, waiting.Id,
                    $"collection-submission:{waiting.Id}", timeProvider.GetUtcNow())],
                cancellationToken);
        });

    public Task CollectionLinkSubmissionAnsweredAsync(long submitterUserId, long collectionId, long submissionId, bool approved, CancellationToken cancellationToken = default)
    {
        var type = approved ? NotificationType.CollectionLinkSubmissionApproved : NotificationType.CollectionLinkSubmissionRejected;
        return SafelyAsync(type, () => EnqueueAsync(
            [Notification.Social(submitterUserId, type, null, collectionId, submissionId,
                $"collection-submission-{(approved ? "approved" : "rejected")}:{submissionId}", timeProvider.GetUtcNow())],
            cancellationToken));
    }

    /// <summary>
    /// A reaction or comment on a link of a shared Collection: its owner (the Item's owner) - when that
    /// is someone else who still owns or belongs to the Collection - gets one notification per actor,
    /// link and CollaborationCoalescing window. Not subject to 새 링크 알림: that setting is about new
    /// links in the Collection, and this is a reply to the recipient's own link.
    /// </summary>
    private Task EnqueueCollaborationAsync(NotificationType type, long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken) =>
        SafelyAsync(type, async () =>
        {
            var target = await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    where membership.CollectionId == collectionId && membership.ItemId == itemId
                    join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                    where item.DeletedAtUtc == null
                    join collection in dbContext.Collections.AsNoTracking() on membership.CollectionId equals collection.Id
                    where collection.DeletedAtUtc == null
                    select new { LinkOwnerUserId = item.UserId, CollectionOwnerUserId = collection.UserId })
                .FirstOrDefaultAsync(cancellationToken);
            if (target is null || target.LinkOwnerUserId == actorUserId)
            {
                return;
            }

            var recipientBelongs = target.LinkOwnerUserId == target.CollectionOwnerUserId
                || await dbContext.CollectionCollaborators.AsNoTracking().AnyAsync(
                    collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == target.LinkOwnerUserId,
                    cancellationToken);
            if (!recipientBelongs)
            {
                return;
            }

            var nowUtc = timeProvider.GetUtcNow();
            await EnqueueAsync(
                [Notification.Social(target.LinkOwnerUserId, type, actorUserId, collectionId, itemId,
                    SocialNotificationPolicy.CollaborationDedupKey(type, collectionId, itemId, actorUserId, nowUtc), nowUtc)],
                cancellationToken);
        });

    private Task EnqueueItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, long? alsoSkipUserId, CancellationToken cancellationToken) =>
        SafelyAsync(NotificationType.CollectionItemsAdded, async () =>
        {
            if (itemCount <= 0)
            {
                return;
            }

            var ownerUserId = await dbContext.Collections.AsNoTracking()
                .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null)
                .Select(collection => (long?)collection.UserId)
                .FirstOrDefaultAsync(cancellationToken);
            if (ownerUserId is null)
            {
                return;
            }

            // Owner + accepted members (a pending invitation is not a member), minus the actor and
            // anyone who turned this Collection's new-link notifications off - set queries, never one
            // per recipient.
            var memberUserIds = await dbContext.CollectionCollaborators.AsNoTracking()
                .Where(collaborator => collaborator.CollectionId == collectionId)
                .Select(collaborator => collaborator.UserId)
                .ToListAsync(cancellationToken);
            var recipients = memberUserIds.Append(ownerUserId.Value)
                .Where(userId => userId != actorUserId && userId != alsoSkipUserId)
                .Distinct()
                .ToList();
            if (recipients.Count == 0)
            {
                return;
            }

            var optedOut = (await dbContext.CollectionNotificationPreferences.AsNoTracking()
                    .Where(preference => preference.CollectionId == collectionId && !preference.NewItemNotificationsEnabled)
                    .Select(preference => preference.UserId)
                    .ToListAsync(cancellationToken))
                .ToHashSet();

            var nowUtc = timeProvider.GetUtcNow();
            var operationId = Guid.NewGuid();
            await EnqueueAsync(
                recipients
                    .Where(userId => !optedOut.Contains(userId))
                    .Select(userId => Notification.Social(
                        userId, NotificationType.CollectionItemsAdded, hideActor ? null : actorUserId, collectionId, null,
                        SocialNotificationPolicy.ItemsAddedDedupKey(collectionId, userId, operationId), nowUtc, itemCount))
                    .ToList(),
                cancellationToken);
        });

    private async Task EnqueueContentChangesAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken)
    {
        if (collectionIds.Count == 0)
        {
            return;
        }

        var ids = collectionIds.Distinct().ToList();
        // Only shared Collections have anyone else to tell: the Owner plus every member.
        var members = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => ids.Contains(collaborator.CollectionId))
            .Select(collaborator => new { collaborator.CollectionId, collaborator.UserId })
            .ToListAsync(cancellationToken);
        if (members.Count == 0)
        {
            return;
        }

        var sharedIds = members.Select(member => member.CollectionId).Distinct().ToList();
        var owners = await dbContext.Collections.AsNoTracking()
            .Where(collection => sharedIds.Contains(collection.Id) && collection.DeletedAtUtc == null)
            .Select(collection => new { CollectionId = collection.Id, collection.UserId })
            .ToListAsync(cancellationToken);

        var nowUtc = timeProvider.GetUtcNow();
        var recipients = owners
            .Concat(members.Where(member => owners.Any(owner => owner.CollectionId == member.CollectionId)))
            .Where(recipient => recipient.UserId != actorUserId)
            .Distinct()
            .Select(recipient => Notification.Social(
                recipient.UserId, NotificationType.CollectionContentChanged, actorUserId, recipient.CollectionId, null,
                SocialNotificationPolicy.ContentChangeDedupKey(recipient.CollectionId, recipient.UserId, nowUtc), nowUtc))
            .ToList();
        await EnqueueAsync(recipients, cancellationToken);
    }

    private async Task EnqueueAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellationToken)
    {
        if (notifications.Count == 0)
        {
            return;
        }

        var keys = notifications.Select(notification => notification.DedupKey!).ToList();
        var existing = (await dbContext.Notifications.AsNoTracking()
                .Where(notification => notification.DedupKey != null && keys.Contains(notification.DedupKey))
                .Select(notification => notification.DedupKey!)
                .ToListAsync(cancellationToken))
            .ToHashSet(StringComparer.Ordinal);

        foreach (var notification in notifications.Where(notification => !existing.Contains(notification.DedupKey!)))
        {
            dbContext.Notifications.Add(notification);
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent request enqueued the same event first - that one is enough.
            }
            finally
            {
                dbContext.Entry(notification).State = EntityState.Detached;
            }
        }
    }

    private async Task SafelyAsync(NotificationType type, Func<Task> action)
    {
        try
        {
            await action();
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            logger.LogWarning(exception, "Could not enqueue a {NotificationType} notification; the app refreshes on its next focus instead.", type);
        }
    }
}
