using Juple.Application.Notifications;
using Juple.Domain.Collections;
using Juple.Domain.Friends;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// What the Push delivery needs to decide on and word a batch of notifications - re-checked at send
/// time, never trusted from when they were recorded. Every check is a set query over the whole batch
/// (only the ones the batch's types need), so a batch costs a fixed number of round trips whatever
/// its size - never one per notification or recipient.
/// </summary>
public sealed class PushDispatchStore(JupleDbContext dbContext) : IPushDispatchStore
{
    public async Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, DateTimeOffset createdBefore, CancellationToken cancellationToken = default) =>
        await dbContext.Notifications
            .AsNoTracking()
            .Where(notification => notification.DispatchedAtUtc == null && notification.DedupKey != null && notification.CreatedAtUtc < createdBefore)
            .OrderBy(notification => notification.CreatedAtUtc)
            .ThenBy(notification => notification.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<Notification>> ListUndispatchedAsync(IReadOnlyCollection<long> notificationIds, CancellationToken cancellationToken = default)
    {
        var ids = notificationIds.Distinct().ToList();
        return await dbContext.Notifications
            .AsNoTracking()
            .Where(notification => ids.Contains(notification.Id) && notification.DispatchedAtUtc == null && notification.DedupKey != null)
            .OrderBy(notification => notification.Id)
            .ToListAsync(cancellationToken);
    }

    public async Task<IReadOnlyDictionary<long, PushDispatchContext>> GetContextsAsync(
        IReadOnlyList<Notification> notifications, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var contexts = new Dictionary<long, PushDispatchContext>();
        if (notifications.Count == 0)
        {
            return contexts;
        }

        bool Has(params NotificationType[] types) => notifications.Any(notification => types.Contains(notification.Type));
        List<long> SubjectsOf(params NotificationType[] types) => notifications
            .Where(notification => types.Contains(notification.Type) && notification.SubjectId is not null)
            .Select(notification => notification.SubjectId!.Value)
            .Distinct()
            .ToList();

        var userIds = notifications.Select(notification => notification.UserId).Distinct().ToList();
        var collectionIds = notifications.Where(notification => notification.CollectionId is not null)
            .Select(notification => notification.CollectionId!.Value).Distinct().ToList();

        var collections = collectionIds.Count == 0
            ? []
            : await dbContext.Collections.AsNoTracking()
                .Where(collection => collectionIds.Contains(collection.Id))
                .Select(collection => new { collection.Id, collection.Name, collection.UserId, collection.DeletedAtUtc })
                .ToDictionaryAsync(collection => collection.Id, cancellationToken);
        var memberships = collectionIds.Count == 0
            ? []
            : (await dbContext.CollectionCollaborators.AsNoTracking()
                .Where(collaborator => collectionIds.Contains(collaborator.CollectionId) && userIds.Contains(collaborator.UserId))
                .Select(collaborator => new { collaborator.CollectionId, collaborator.UserId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.UserId))
                .ToHashSet();

        bool IsLive(long? collectionId) =>
            collectionId is { } id && collections.TryGetValue(id, out var collection) && collection.DeletedAtUtc == null;
        bool Belongs(long? collectionId, long userId) =>
            IsLive(collectionId) && (collections[collectionId!.Value].UserId == userId || memberships.Contains((collectionId.Value, userId)));

        // Still an unanswered request from that same person to this recipient.
        var friendshipIds = SubjectsOf(NotificationType.FriendRequestReceived);
        var pendingFriendships = friendshipIds.Count == 0
            ? []
            : await dbContext.Friendships.AsNoTracking()
                .Where(friendship => friendshipIds.Contains(friendship.Id) && friendship.Status == FriendshipStatus.Pending)
                .Select(friendship => new { friendship.Id, friendship.RequestedByUserId, friendship.UserLowId, friendship.UserHighId })
                .ToDictionaryAsync(friendship => friendship.Id, cancellationToken);

        var invitationIds = SubjectsOf(NotificationType.CollectionInvitationReceived);
        var pendingInvitations = invitationIds.Count == 0
            ? []
            : await dbContext.CollectionInvitations.AsNoTracking()
                .Where(invitation => invitationIds.Contains(invitation.Id)
                    && invitation.Status == CollectionInvitationStatus.Pending
                    && invitation.ExpiresAtUtc > nowUtc)
                .Select(invitation => new { invitation.Id, invitation.InvitedUserId })
                .ToDictionaryAsync(invitation => invitation.Id, invitation => invitation.InvitedUserId, cancellationToken);

        // 새 링크 알림 turned off since the notification was recorded.
        var optedOut = !Has(NotificationType.CollectionItemsAdded)
            ? []
            : (await dbContext.CollectionNotificationPreferences.AsNoTracking()
                .Where(preference => collectionIds.Contains(preference.CollectionId)
                    && userIds.Contains(preference.UserId)
                    && !preference.NewItemNotificationsEnabled)
                .Select(preference => new { preference.CollectionId, preference.UserId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.UserId))
                .ToHashSet();

        // The public link as it is right now (a passed-on link; a proposal result for a non-member).
        var activeShares = !Has(NotificationType.CollectionLinkShared, NotificationType.CollectionLinkSubmissionApproved, NotificationType.CollectionLinkSubmissionRejected)
            ? []
            : (await dbContext.CollectionShares.AsNoTracking()
                .Where(share => collectionIds.Contains(share.CollectionId) && share.IsActive)
                .Select(share => new { share.CollectionId, share.PublicId })
                .ToListAsync(cancellationToken))
                .GroupBy(share => share.CollectionId)
                .ToDictionary(group => group.Key, group => group.First().PublicId);

        // A reaction/comment: the link is still in the Collection, still the recipient's own live Item,
        // and what the actor left there still exists.
        var linkItemIds = SubjectsOf(NotificationType.CollectionItemReactionReceived, NotificationType.CollectionItemCommentReceived);
        var ownLinks = linkItemIds.Count == 0
            ? []
            : (await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    where collectionIds.Contains(membership.CollectionId) && linkItemIds.Contains(membership.ItemId)
                    join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                    where item.DeletedAtUtc == null
                    select new { membership.CollectionId, membership.ItemId, item.UserId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.ItemId, entry.UserId))
                .ToHashSet();
        var actorIds = notifications.Where(notification => notification.ActorUserId is not null)
            .Select(notification => notification.ActorUserId!.Value).Distinct().ToList();
        var reactions = !Has(NotificationType.CollectionItemReactionReceived)
            ? []
            : (await dbContext.CollectionItemReactions.AsNoTracking()
                .Where(reaction => collectionIds.Contains(reaction.CollectionId) && linkItemIds.Contains(reaction.ItemId) && actorIds.Contains(reaction.UserId))
                .Select(reaction => new { reaction.CollectionId, reaction.ItemId, reaction.UserId })
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.ItemId, entry.UserId))
                .ToHashSet();
        var comments = !Has(NotificationType.CollectionItemCommentReceived)
            ? []
            : (await dbContext.CollectionItemComments.AsNoTracking()
                .Where(comment => collectionIds.Contains(comment.CollectionId) && linkItemIds.Contains(comment.ItemId) && actorIds.Contains(comment.UserId))
                .Select(comment => new { comment.CollectionId, comment.ItemId, comment.UserId })
                .Distinct()
                .ToListAsync(cancellationToken))
                .Select(entry => (entry.CollectionId, entry.ItemId, entry.UserId))
                .ToHashSet();

        // A proposal: still waiting.
        var submissionIds = SubjectsOf(NotificationType.CollectionLinkSubmissionReceived);
        var waitingSubmissions = submissionIds.Count == 0
            ? []
            : await dbContext.CollectionLinkSubmissions.AsNoTracking()
                .Where(submission => submissionIds.Contains(submission.Id))
                .Select(submission => new { submission.Id, submission.CollectionId })
                .ToDictionaryAsync(submission => submission.Id, submission => submission.CollectionId, cancellationToken);

        bool IsRelevant(Notification notification)
        {
            var userId = notification.UserId;
            switch (notification.Type)
            {
                case NotificationType.FriendRequestReceived:
                    return notification.SubjectId is { } friendshipId
                        && pendingFriendships.TryGetValue(friendshipId, out var friendship)
                        && friendship.RequestedByUserId == notification.ActorUserId
                        && (friendship.UserLowId == userId || friendship.UserHighId == userId);
                case NotificationType.CollectionInvitationReceived:
                    return notification.SubjectId is { } invitationId
                        && pendingInvitations.TryGetValue(invitationId, out var invitedUserId)
                        && invitedUserId == userId;
                // Refresh signals: only while the recipient still owns / belongs to that Collection.
                case NotificationType.CollectionInvitationAnswered:
                case NotificationType.CollectionContentChanged:
                    return Belongs(notification.CollectionId, userId);
                case NotificationType.CollectionItemsAdded:
                    return Belongs(notification.CollectionId, userId) && !optedOut.Contains((notification.CollectionId!.Value, userId));
                case NotificationType.CollectionLinkShared:
                    return IsLive(notification.CollectionId) && activeShares.ContainsKey(notification.CollectionId!.Value);
                case NotificationType.CollectionItemReactionReceived:
                case NotificationType.CollectionItemCommentReceived:
                    if (notification.CollectionId is not { } collectionId || notification.SubjectId is not { } itemId || notification.ActorUserId is not { } actorUserId)
                    {
                        return false;
                    }

                    return Belongs(collectionId, userId)
                        && ownLinks.Contains((collectionId, itemId, userId))
                        && (notification.Type == NotificationType.CollectionItemReactionReceived
                            ? reactions.Contains((collectionId, itemId, actorUserId))
                            : comments.Contains((collectionId, itemId, actorUserId)));
                case NotificationType.CollectionLinkSubmissionReceived:
                    return notification.SubjectId is { } submissionId
                        && waitingSubmissions.TryGetValue(submissionId, out var submissionCollectionId)
                        && submissionCollectionId == notification.CollectionId
                        && IsLive(notification.CollectionId)
                        && collections[notification.CollectionId!.Value].UserId == userId;
                // The result of the recipient's own proposal stays true; only a deleted Collection makes it moot.
                case NotificationType.CollectionLinkSubmissionApproved:
                case NotificationType.CollectionLinkSubmissionRejected:
                    return IsLive(notification.CollectionId);
                // Refresh signal about the recipient's own (now answered) request - nothing to re-check.
                case NotificationType.FriendRequestAnswered:
                    return true;
                default:
                    return false;
            }
        }

        var relevant = notifications.Where(IsRelevant).ToList();
        foreach (var notification in notifications.Except(relevant))
        {
            contexts[notification.Id] = new PushDispatchContext(false, null, null, 0);
        }

        if (relevant.Count == 0)
        {
            return contexts;
        }

        var relevantActorIds = relevant.Where(notification => notification.ActorUserId is not null)
            .Select(notification => notification.ActorUserId!.Value).Distinct().ToList();
        var actors = relevantActorIds.Count == 0
            ? []
            : await dbContext.Users.AsNoTracking()
                .Where(user => relevantActorIds.Contains(user.Id))
                .Select(user => new { user.Id, user.DisplayName, user.PublicCode })
                .ToDictionaryAsync(user => user.Id, cancellationToken);

        // The launcher badge: each recipient's unanswered friend requests + Collection invitations.
        var recipientIds = relevant.Select(notification => notification.UserId).Distinct().ToList();
        var pendingRequests = await dbContext.Friendships.AsNoTracking()
            .Where(friendship => friendship.Status == FriendshipStatus.Pending
                && (recipientIds.Contains(friendship.UserLowId) || recipientIds.Contains(friendship.UserHighId)))
            .Select(friendship => new { friendship.UserLowId, friendship.UserHighId, friendship.RequestedByUserId })
            .ToListAsync(cancellationToken);
        var pendingInvitationCounts = await dbContext.CollectionInvitations.AsNoTracking()
            .Where(invitation => recipientIds.Contains(invitation.InvitedUserId)
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc)
            .GroupBy(invitation => invitation.InvitedUserId)
            .Select(group => new { UserId = group.Key, Count = group.Count() })
            .ToDictionaryAsync(entry => entry.UserId, entry => entry.Count, cancellationToken);
        int BadgeOf(long userId) =>
            pendingRequests.Count(request => request.RequestedByUserId != userId && (request.UserLowId == userId || request.UserHighId == userId))
            + pendingInvitationCounts.GetValueOrDefault(userId);

        foreach (var notification in relevant)
        {
            var actor = notification.ActorUserId is { } actorUserId && actors.TryGetValue(actorUserId, out var found) ? found : null;
            var isProposalResult = notification.Type
                is NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected;
            // A proposal's result may open the Collection itself only for someone who belongs to it,
            // else its public link while that is on, else nothing.
            var recipientBelongs = !isProposalResult || Belongs(notification.CollectionId, notification.UserId);
            var publicShareId = (notification.Type == NotificationType.CollectionLinkShared || (isProposalResult && !recipientBelongs))
                && notification.CollectionId is { } shareCollectionId
                    ? activeShares.GetValueOrDefault(shareCollectionId)
                    : null;
            contexts[notification.Id] = new PushDispatchContext(
                true,
                actor is null ? null : string.IsNullOrWhiteSpace(actor.DisplayName) ? FormatJupleId(actor.PublicCode) : actor.DisplayName,
                notification.CollectionId is { } collectionId && collections.TryGetValue(collectionId, out var collection) ? collection.Name : null,
                BadgeOf(notification.UserId),
                publicShareId,
                recipientBelongs);
        }

        return contexts;
    }

    public async Task MarkDispatchedAsync(IReadOnlyCollection<long> notificationIds, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (notificationIds.Count == 0)
        {
            return;
        }

        var ids = notificationIds.Distinct().ToList();
        await dbContext.Notifications
            .Where(notification => ids.Contains(notification.Id) && notification.DispatchedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.DispatchedAtUtc, nowUtc), cancellationToken);
    }

    /// <summary>Same "ABCD-EFGH" form the app shows.</summary>
    public static string FormatJupleId(string publicCode) =>
        publicCode.Length == 8 ? $"{publicCode[..4]}-{publicCode[4..]}" : publicCode;
}
