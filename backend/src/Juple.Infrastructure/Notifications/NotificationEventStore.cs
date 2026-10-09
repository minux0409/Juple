using Juple.Application.Notifications;
using Juple.Domain.Collections;
using Juple.Domain.Friends;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// Turns outbox events into their recipients' Notification rows - the who-is-told rules that used to
/// run inside the user's request (see SocialNotificationPublisher's history), now run asynchronously:
///  - never the actor, never the approving Owner (SkipUserId), never a pending invitee;
///  - 새 링크 알림 off excludes a recipient from new-link notifications only;
///  - a reaction/comment goes to the link's owner, only if that is someone else who still belongs;
///  - a proposal goes to the Collection's Owner without naming the proposer.
/// A Collection's audience is walked with keyset paging on UserId (UX_CollectionCollaborators_
/// CollectionId_UserId): per page one keyset query, at most one opt-out query, one existing-key check
/// and one batched insert - a fixed number of round trips whatever the page size, never one per
/// recipient, and memory bounded by the page. Each page's rows and the event's new cursor commit
/// together, and every row has a deterministic DedupKey (UX_Notifications_DedupKey), so a redelivered
/// message or a retried page never creates a second notification.
/// </summary>
public sealed class NotificationEventStore(JupleDbContext dbContext) : INotificationEventStore
{
    private const int MaxPageAttempts = 3;

    public async Task<int?> TryClaimAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        // One conditional UPDATE: the affected-row count is the claim. A live lease (another worker, a
        // redelivered message, the recovery Job), a retry not yet due, or a completed event matches
        // nothing. There is no attempt limit - a transient failure is retried for as long as it takes.
        var claimed = await dbContext.NotificationEvents
            .Where(entry => entry.Id == eventId
                && entry.Status == NotificationEventStatus.Pending
                && (entry.LeaseUntilUtc == null || entry.LeaseUntilUtc <= nowUtc)
                && (entry.NextAttemptAtUtc == null || entry.NextAttemptAtUtc <= nowUtc))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(entry => entry.LeaseUntilUtc, nowUtc + lease)
                    .SetProperty(entry => entry.LastAttemptAtUtc, nowUtc)
                    .SetProperty(entry => entry.AttemptCount, entry => entry.AttemptCount + 1),
                cancellationToken);
        if (claimed != 1)
        {
            return null;
        }

        return await dbContext.NotificationEvents.AsNoTracking()
            .Where(entry => entry.Id == eventId)
            .Select(entry => entry.AttemptCount)
            .FirstAsync(cancellationToken);
    }

    public async Task<MaterializedPage> MaterializeNextPageAsync(
        long eventId, int pageSize, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        var notificationEvent = await dbContext.NotificationEvents.AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.Id == eventId && entry.Status == NotificationEventStatus.Pending, cancellationToken);
        if (notificationEvent is null)
        {
            return new MaterializedPage([], true, []);
        }

        if (!IsWellFormed(notificationEvent))
        {
            // Retrying cannot repair a structurally impossible event: closed for good, visible to operations.
            await MarkCompletedAsync(eventId, NotificationEventStatus.FailedPermanent, null, MalformedEventCode, nowUtc, cancellationToken);
            return new MaterializedPage([], true, [], MalformedEventCode);
        }

        switch (notificationEvent.Type)
        {
            case NotificationType.CollectionContentChanged when notificationEvent.CollectionId is null:
                return await ExpandItemEventAsync(notificationEvent, nowUtc, cancellationToken);

            case NotificationType.CollectionContentChanged:
            case NotificationType.CollectionItemsAdded:
                return await MaterializeAudiencePageAsync(notificationEvent, pageSize, nowUtc, lease, cancellationToken);

            default:
                var single = await ResolveSingleAsync(notificationEvent, cancellationToken);
                var ids = await CommitPageAsync(notificationEvent.Id, single is null ? [] : [single], null, completed: true, nowUtc, lease, cancellationToken);
                return new MaterializedPage(ids, true, []);
        }
    }

    public async Task ScheduleRetryAsync(
        long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool requiresAttention, CancellationToken cancellationToken = default)
    {
        var code = Truncate(errorCode);
        await dbContext.NotificationEvents
            .Where(entry => entry.Id == eventId && entry.Status == NotificationEventStatus.Pending)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(entry => entry.LeaseUntilUtc, (DateTimeOffset?)null)
                    .SetProperty(entry => entry.NextAttemptAtUtc, nextAttemptAtUtc)
                    .SetProperty(entry => entry.RequiresAttention, entry => entry.RequiresAttention || requiresAttention)
                    .SetProperty(entry => entry.LastErrorCode, code),
                cancellationToken);
    }

    public async Task<IReadOnlyList<long>> ListRecoverableAsync(
        int limit, DateTimeOffset createdBefore, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        await dbContext.NotificationEvents.AsNoTracking()
            .Where(entry => entry.Status == NotificationEventStatus.Pending
                && entry.CreatedAtUtc < createdBefore
                && (entry.LeaseUntilUtc == null || entry.LeaseUntilUtc <= nowUtc)
                && (entry.NextAttemptAtUtc == null || entry.NextAttemptAtUtc <= nowUtc))
            .OrderBy(entry => entry.CreatedAtUtc)
            .ThenBy(entry => entry.Id)
            .Select(entry => entry.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task<int> DeleteCompletedBeforeAsync(DateTimeOffset cutoff, int limit, CancellationToken cancellationToken = default)
    {
        var ids = await dbContext.NotificationEvents.AsNoTracking()
            .Where(entry => entry.CompletedAtUtc != null && entry.CompletedAtUtc < cutoff)
            .OrderBy(entry => entry.CompletedAtUtc)
            .Select(entry => entry.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.NotificationEvents.Where(entry => ids.Contains(entry.Id)).ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<NotificationOutboxStats> GetStatsAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var events = await dbContext.NotificationEvents.AsNoTracking()
            .Where(entry => entry.Status == NotificationEventStatus.Pending)
            .GroupBy(_ => 1)
            .Select(group => new
            {
                Count = group.Count(),
                Oldest = group.Min(entry => entry.CreatedAtUtc),
                Attention = group.Count(entry => entry.RequiresAttention),
            })
            .FirstOrDefaultAsync(cancellationToken);
        var failedPermanently = await dbContext.NotificationEvents.AsNoTracking()
            .CountAsync(entry => entry.Status == NotificationEventStatus.FailedPermanent, cancellationToken); // IX_NotificationEvents_FailedPermanent: only those rows
        var notifications = await dbContext.Notifications.AsNoTracking()
            .Where(notification => notification.DispatchedAtUtc == null && notification.DedupKey != null)
            .GroupBy(_ => 1)
            .Select(group => new { Count = group.Count(), Oldest = group.Min(notification => notification.CreatedAtUtc) })
            .FirstOrDefaultAsync(cancellationToken);
        return new NotificationOutboxStats(
            events?.Count ?? 0,
            events is null ? null : (nowUtc - events.Oldest).TotalSeconds,
            notifications?.Count ?? 0,
            notifications is null ? null : (nowUtc - notifications.Oldest).TotalSeconds,
            events?.Attention ?? 0,
            failedPermanently);
    }

    public const string MalformedEventCode = "MalformedEvent";

    /// <summary>The ids each type cannot do without - anything else is an event no retry can process.</summary>
    public static bool IsWellFormed(NotificationEvent notificationEvent) => notificationEvent.Type switch
    {
        NotificationType.FriendRequestReceived or NotificationType.FriendRequestAnswered or NotificationType.FriendRequestAccepted
            or NotificationType.FriendRequestRejected or NotificationType.CollectionInvitationReceived
            => notificationEvent.RecipientUserId is not null && notificationEvent.SubjectId is not null,
        NotificationType.CollectionInvitationAnswered => notificationEvent.ActorUserId is not null && notificationEvent.SubjectId is not null,
        NotificationType.CollectionContentChanged => notificationEvent.CollectionId is not null || notificationEvent.SubjectId is not null,
        NotificationType.CollectionItemsAdded => notificationEvent.CollectionId is not null,
        NotificationType.CollectionLinkShared => notificationEvent.RecipientUserId is not null && notificationEvent.CollectionId is not null,
        NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived or NotificationType.CollectionLinkSubmissionReceived
            => notificationEvent.ActorUserId is not null && notificationEvent.CollectionId is not null && notificationEvent.SubjectId is not null,
        NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected
            => notificationEvent.RecipientUserId is not null && notificationEvent.SubjectId is not null,
        NotificationType.JoinRequestReceived or NotificationType.JoinRequestApproved or NotificationType.JoinRequestRejected
            => notificationEvent.ActorUserId is not null && notificationEvent.RecipientUserId is not null
                && notificationEvent.CollectionId is not null && notificationEvent.SubjectId is not null,
        NotificationType.CommentReplyReceived or NotificationType.CommentLikeReceived
            => notificationEvent.ActorUserId is not null && notificationEvent.RecipientUserId is not null && notificationEvent.CollectionId is not null
                && notificationEvent.SubjectId is not null && notificationEvent.ItemId is not null,
        _ => false,
    };

    private static string Truncate(string code) =>
        code.Length > NotificationEvent.LastErrorCodeMaxLength ? code[..NotificationEvent.LastErrorCodeMaxLength] : code;

    /// <summary>
    /// One page of a Collection's audience - its Owner and accepted members, in UserId order, after the
    /// cursor. The Owner is not a CollectionCollaborators row, so it is merged into the keyset by id.
    /// </summary>
    private async Task<MaterializedPage> MaterializeAudiencePageAsync(
        NotificationEvent notificationEvent, int pageSize, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken)
    {
        var collectionId = notificationEvent.CollectionId!.Value;
        var ownerUserId = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null)
            .Select(collection => (long?)collection.UserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (ownerUserId is null)
        {
            await CommitPageAsync(notificationEvent.Id, [], null, completed: true, nowUtc, lease, cancellationToken);
            return new MaterializedPage([], true, []);
        }

        var cursor = notificationEvent.RecipientCursor ?? 0;
        var members = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == collectionId && collaborator.UserId > cursor)
            .OrderBy(collaborator => collaborator.UserId)
            .Select(collaborator => collaborator.UserId)
            .Take(pageSize)
            .ToListAsync(cancellationToken);

        // A content-change refresh is for shared Collections only - nobody else is looking at it.
        if (notificationEvent.Type == NotificationType.CollectionContentChanged && notificationEvent.RecipientCursor is null && members.Count == 0)
        {
            await CommitPageAsync(notificationEvent.Id, [], null, completed: true, nowUtc, lease, cancellationToken);
            return new MaterializedPage([], true, []);
        }

        var candidates = new SortedSet<long>(members);
        if (ownerUserId.Value > cursor)
        {
            candidates.Add(ownerUserId.Value);
        }

        var page = candidates.Take(pageSize).ToList();
        // Fewer members than a page = none left after these (the Owner, if beyond, is in this page too).
        var completed = members.Count < pageSize;
        var newCursor = page.Count > 0 ? page[^1] : cursor;

        var recipients = page
            .Where(userId => userId != notificationEvent.ActorUserId && userId != notificationEvent.SkipUserId)
            .ToList();
        // Turning a Collection's 알림 off never removes a recipient here: the Inbox row (history, unread) is always recorded.
        // Only the Push is decided later, at dispatch (PushDispatchStore), from the preference as it is then.

        var rows = recipients.Select(userId => notificationEvent.Type == NotificationType.CollectionItemsAdded
                ? Notification.Social(
                    userId, NotificationType.CollectionItemsAdded, notificationEvent.HideActor ? null : notificationEvent.ActorUserId, collectionId, null,
                    SocialNotificationPolicy.ItemsAddedDedupKey(collectionId, userId, notificationEvent.Id), notificationEvent.CreatedAtUtc, notificationEvent.ItemCount)
                : Notification.Social(
                    userId, NotificationType.CollectionContentChanged, notificationEvent.ActorUserId, collectionId, null,
                    SocialNotificationPolicy.ContentChangeDedupKey(collectionId, userId, notificationEvent.CreatedAtUtc), notificationEvent.CreatedAtUtc))
            .ToList();

        var ids = await CommitPageAsync(notificationEvent.Id, rows, newCursor, completed, nowUtc, lease, cancellationToken);
        return new MaterializedPage(ids, completed, []);
    }

    /// <summary>
    /// An Item's deletion/restore changes every shared Collection it is in: one per-Collection content
    /// event each (the same coalescing key a direct change would use), and this one is done.
    /// </summary>
    private async Task<MaterializedPage> ExpandItemEventAsync(NotificationEvent notificationEvent, DateTimeOffset nowUtc, CancellationToken cancellationToken)
    {
        var collectionIds = notificationEvent.SubjectId is { } itemId
            ? await dbContext.CollectionItems.AsNoTracking()
                .Where(membership => membership.ItemId == itemId)
                .Select(membership => membership.CollectionId)
                .Distinct()
                .ToListAsync(cancellationToken)
            : [];
        var actorUserId = notificationEvent.ActorUserId ?? 0;

        for (var attempt = 1; ; attempt++)
        {
            await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
            var children = collectionIds
                .Select(collectionId => new NotificationEvent(
                    NotificationType.CollectionContentChanged, notificationEvent.ActorUserId, null, collectionId, null, null, false, null,
                    NotificationEventKeys.CollectionContentChanged(collectionId, actorUserId, notificationEvent.CreatedAtUtc), notificationEvent.CreatedAtUtc))
                .ToList();
            var keys = children.Select(child => child.DedupKey!).ToList();
            var existing = keys.Count == 0
                ? []
                : (await dbContext.NotificationEvents.AsNoTracking()
                    .Where(entry => entry.DedupKey != null && keys.Contains(entry.DedupKey))
                    .Select(entry => entry.DedupKey!)
                    .ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);
            var fresh = children.Where(child => !existing.Contains(child.DedupKey!)).ToList();
            try
            {
                dbContext.NotificationEvents.AddRange(fresh);
                await dbContext.SaveChangesAsync(cancellationToken);
                await MarkProcessedAsync(notificationEvent.Id, null, nowUtc, cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new MaterializedPage([], true, fresh.Select(child => child.Id).ToList());
            }
            catch (DbUpdateException exception) when (attempt < MaxPageAttempts && SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent direct change recorded one of these children first - read again and retry.
            }
            finally
            {
                dbContext.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>The one notification of a single-recipient event, or null when nobody is to be told (anymore).</summary>
    private async Task<Notification?> ResolveSingleAsync(NotificationEvent notificationEvent, CancellationToken cancellationToken)
    {
        var actor = notificationEvent.ActorUserId;
        var createdAtUtc = notificationEvent.CreatedAtUtc;
        switch (notificationEvent.Type)
        {
            case NotificationType.FriendRequestReceived when notificationEvent.RecipientUserId is { } recipient && notificationEvent.SubjectId is { } friendshipId:
                // Only while it still waits: a request its sender cancelled (or that was answered) before this
                // event was processed never reaches the recipient's Inbox - the cancel could not delete a row
                // that did not exist yet.
                return await dbContext.Friendships.AsNoTracking().AnyAsync(
                        friendship => friendship.Id == friendshipId
                            && friendship.Status == FriendshipStatus.Pending
                            && friendship.RequestedByUserId == actor,
                        cancellationToken)
                    ? Notification.Social(recipient, notificationEvent.Type, actor, null, friendshipId, $"friend-request:{friendshipId}", createdAtUtc)
                    : null;

            case NotificationType.FriendRequestAnswered when notificationEvent.RecipientUserId is { } recipient && notificationEvent.SubjectId is { } friendshipId:
                return Notification.Social(recipient, notificationEvent.Type, actor, null, friendshipId, $"friend-request-answered:{friendshipId}", createdAtUtc);

            // The requester is told once per answered request (the key is the request's own id + the answer).
            case NotificationType.FriendRequestAccepted or NotificationType.FriendRequestRejected
                when notificationEvent.RecipientUserId is { } recipient && notificationEvent.SubjectId is { } friendshipId:
                return Notification.Social(
                    recipient, notificationEvent.Type, actor, null, friendshipId,
                    $"friend-request-{(notificationEvent.Type == NotificationType.FriendRequestAccepted ? "accepted" : "rejected")}:{friendshipId}", createdAtUtc);

            case NotificationType.CollectionInvitationReceived when notificationEvent.RecipientUserId is { } recipient && notificationEvent.SubjectId is { } invitationId:
                return Notification.Social(
                    recipient, notificationEvent.Type, actor, notificationEvent.CollectionId, invitationId, $"collection-invitation:{invitationId}", createdAtUtc);

            case NotificationType.CollectionInvitationAnswered when notificationEvent.SubjectId is { } invitationId:
                var invitation = await dbContext.CollectionInvitations.AsNoTracking()
                    .Where(entry => entry.Id == invitationId && entry.InvitedUserId == actor)
                    .Select(entry => new { entry.CollectionId, entry.InvitedByUserId })
                    .FirstOrDefaultAsync(cancellationToken);
                return invitation is null
                    ? null
                    : Notification.Social(
                        invitation.InvitedByUserId, notificationEvent.Type, actor, invitation.CollectionId, invitationId, $"invitation-answered:{invitationId}", createdAtUtc);

            case NotificationType.CollectionLinkShared when notificationEvent.RecipientUserId is { } recipient && notificationEvent.CollectionId is { } collectionId:
                return Notification.Social(
                    recipient, notificationEvent.Type, actor, collectionId, null, $"collection-link:{collectionId}:{recipient}:e{notificationEvent.Id}", createdAtUtc);

            case NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived
                when actor is { } actorUserId && notificationEvent.CollectionId is { } collectionId && notificationEvent.SubjectId is { } itemId:
                // The link's owner (the Item's, not the Collection's) - when that is someone else who
                // still owns or belongs to the Collection.
                var target = await (
                        from membership in dbContext.CollectionItems.AsNoTracking()
                        where membership.CollectionId == collectionId && membership.ItemId == itemId
                        join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                        where item.DeletedAtUtc == null
                        join collection in dbContext.Collections.AsNoTracking() on membership.CollectionId equals collection.Id
                        where collection.DeletedAtUtc == null
                        select new
                        {
                            LinkOwnerUserId = item.UserId,
                            Belongs = item.UserId == collection.UserId
                                || dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == item.UserId),
                        })
                    .FirstOrDefaultAsync(cancellationToken);
                return target is null || target.LinkOwnerUserId == actorUserId || !target.Belongs
                    ? null
                    : Notification.Social(
                        target.LinkOwnerUserId, notificationEvent.Type, actorUserId, collectionId, itemId,
                        SocialNotificationPolicy.CollaborationDedupKey(notificationEvent.Type, collectionId, itemId, actorUserId, createdAtUtc), createdAtUtc);

            case NotificationType.CollectionLinkSubmissionReceived
                when actor is { } submitterUserId && notificationEvent.CollectionId is { } collectionId && notificationEvent.SubjectId is { } itemId:
                // The proposal as it waits now (approved or rejected meanwhile: nothing to tell). No actor
                // on the notification - who proposed is never part of it.
                var waiting = await (
                        from submission in dbContext.CollectionLinkSubmissions.AsNoTracking()
                        where submission.CollectionId == collectionId && submission.ItemId == itemId && submission.SubmittedByUserId == submitterUserId
                        join collection in dbContext.Collections.AsNoTracking() on submission.CollectionId equals collection.Id
                        where collection.DeletedAtUtc == null
                        orderby submission.Id descending
                        select new { submission.Id, OwnerUserId = collection.UserId })
                    .FirstOrDefaultAsync(cancellationToken);
                return waiting is null || waiting.OwnerUserId == submitterUserId
                    ? null
                    : Notification.Social(waiting.OwnerUserId, notificationEvent.Type, null, collectionId, waiting.Id, $"collection-submission:{waiting.Id}", createdAtUtc);

            case NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected
                when notificationEvent.RecipientUserId is { } recipient && notificationEvent.SubjectId is { } submissionId:
                var answer = notificationEvent.Type == NotificationType.CollectionLinkSubmissionApproved ? "approved" : "rejected";
                return Notification.Social(
                    recipient, notificationEvent.Type, null, notificationEvent.CollectionId, submissionId, $"collection-submission-{answer}:{submissionId}", createdAtUtc,
                    itemId: notificationEvent.ItemId);

            // A join request: told to the Owner only while it still waits; the answer to the requester only for the answer it got.
            case NotificationType.JoinRequestReceived or NotificationType.JoinRequestApproved or NotificationType.JoinRequestRejected
                when actor is { } joinActor && notificationEvent.RecipientUserId is { } joinRecipient
                    && notificationEvent.CollectionId is { } joinCollectionId && notificationEvent.SubjectId is { } joinRequestId:
                return await ResolveJoinRequestNotificationAsync(notificationEvent.Type, joinActor, joinRecipient, joinCollectionId, joinRequestId, createdAtUtc, cancellationToken);

            case NotificationType.CommentReplyReceived or NotificationType.CommentLikeReceived
                when actor is { } threadActor && notificationEvent.RecipientUserId is { } threadRecipient && notificationEvent.CollectionId is { } threadCollectionId
                    && notificationEvent.SubjectId is { } commentId && notificationEvent.ItemId is { } threadItemId:
                return await ResolveThreadNotificationAsync(notificationEvent.Type, threadActor, threadRecipient, threadCollectionId, threadItemId, commentId, createdAtUtc, cancellationToken);

            default:
                // Unreachable for a well-formed event (IsWellFormed is checked first).
                return null;
        }
    }

    private async Task<Notification?> ResolveJoinRequestNotificationAsync(
        NotificationType type, long actorUserId, long recipientUserId, long collectionId, long requestId, DateTimeOffset createdAtUtc, CancellationToken cancellationToken)
    {
        var request = await dbContext.CollectionJoinRequests.AsNoTracking()
            .Where(entry => entry.Id == requestId && entry.CollectionId == collectionId)
            .Select(entry => new { entry.RequesterUserId, entry.Status })
            .FirstOrDefaultAsync(cancellationToken);
        var ownerUserId = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null)
            .Select(collection => (long?)collection.UserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (request is null || ownerUserId is null)
        {
            return null;
        }

        switch (type)
        {
            case NotificationType.JoinRequestReceived:
                // The requester asked and nobody has answered yet; the Owner is the recipient.
                return request.Status == CollectionJoinRequestStatus.Pending && request.RequesterUserId == actorUserId && ownerUserId == recipientUserId
                    ? Notification.Social(recipientUserId, type, actorUserId, collectionId, requestId, $"join-request:{requestId}", createdAtUtc)
                    : null;
            case NotificationType.JoinRequestApproved:
                return request.Status == CollectionJoinRequestStatus.Approved && request.RequesterUserId == recipientUserId
                    ? Notification.Social(recipientUserId, type, actorUserId, collectionId, requestId, $"join-request-approved:{requestId}", createdAtUtc)
                    : null;
            default:
                return request.Status == CollectionJoinRequestStatus.Rejected && request.RequesterUserId == recipientUserId
                    ? Notification.Social(recipientUserId, type, actorUserId, collectionId, requestId, $"join-request-rejected:{requestId}", createdAtUtc)
                    : null;
        }
    }

    /// <summary>
    /// A reply / heart notification, decided from the facts as they are NOW: nobody is told about their own action, and nothing is sent
    /// once what it was about is gone - the reply deleted, the heart taken back, the link out of the Collection, or the recipient no longer
    /// in it. The keys make a retried or repeated event one notification: a reply once, a heart once per person and comment for ever.
    /// </summary>
    private async Task<Notification?> ResolveThreadNotificationAsync(
        NotificationType type, long actorUserId, long recipientUserId, long collectionId, long itemId, long commentId, DateTimeOffset createdAtUtc, CancellationToken cancellationToken)
    {
        if (recipientUserId == actorUserId)
        {
            return null;
        }

        var comment = await dbContext.CollectionItemComments.AsNoTracking()
            .Where(entry => entry.Id == commentId && entry.CollectionId == collectionId && entry.ItemId == itemId && entry.DeletedAtUtc == null)
            .Select(entry => new { entry.UserId, entry.ReplyToUserId })
            .FirstOrDefaultAsync(cancellationToken);
        if (comment is null)
        {
            return null;
        }

        if (type == NotificationType.CommentReplyReceived)
        {
            // The new reply is the actor's own and answers the recipient.
            if (comment.UserId != actorUserId || comment.ReplyToUserId != recipientUserId)
            {
                return null;
            }
        }
        else if (comment.UserId != recipientUserId
            || !await dbContext.CollectionItemCommentLikes.AsNoTracking().AnyAsync(like => like.CommentId == commentId && like.UserId == actorUserId, cancellationToken))
        {
            // A heart on the recipient's comment that still exists.
            return null;
        }

        var belongs = await (
                from membership in dbContext.CollectionItems.AsNoTracking()
                where membership.CollectionId == collectionId && membership.ItemId == itemId
                join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                where item.DeletedAtUtc == null
                join collection in dbContext.Collections.AsNoTracking() on membership.CollectionId equals collection.Id
                where collection.DeletedAtUtc == null
                select collection.UserId == recipientUserId
                    || dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collectionId && collaborator.UserId == recipientUserId))
            .FirstOrDefaultAsync(cancellationToken);
        if (!belongs)
        {
            return null;
        }

        var dedupKey = type == NotificationType.CommentReplyReceived
            ? $"comment-reply:{commentId}"
            : $"comment-like:{commentId}:{actorUserId}";
        return Notification.Social(recipientUserId, type, actorUserId, collectionId, commentId, dedupKey, createdAtUtc, itemId: itemId);
    }

    /// <summary>
    /// The page's new rows (minus any that exist already - a repeated page) and the event's progress,
    /// in one transaction. Returns the ids of the rows this call created.
    /// </summary>
    private async Task<IReadOnlyList<long>> CommitPageAsync(
        long eventId, IReadOnlyList<Notification> rows, long? newCursor, bool completed, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken)
    {
        for (var attempt = 1; ; attempt++)
        {
            await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
            try
            {
                var keys = rows.Select(row => row.DedupKey!).ToList();
                var existing = keys.Count == 0
                    ? []
                    : (await dbContext.Notifications.AsNoTracking()
                        .Where(notification => notification.DedupKey != null && keys.Contains(notification.DedupKey))
                        .Select(notification => notification.DedupKey!)
                        .ToListAsync(cancellationToken)).ToHashSet(StringComparer.Ordinal);
                var fresh = rows.Where(row => !existing.Contains(row.DedupKey!)).ToList();
                dbContext.Notifications.AddRange(fresh);
                await dbContext.SaveChangesAsync(cancellationToken);

                if (completed)
                {
                    await MarkProcessedAsync(eventId, newCursor, nowUtc, cancellationToken);
                }
                else
                {
                    await dbContext.NotificationEvents
                        .Where(entry => entry.Id == eventId && entry.Status == NotificationEventStatus.Pending)
                        .ExecuteUpdateAsync(
                            setters => setters
                                .SetProperty(entry => entry.RecipientCursor, newCursor)
                                .SetProperty(entry => entry.LeaseUntilUtc, nowUtc + lease),
                            cancellationToken);
                }

                await transaction.CommitAsync(cancellationToken);
                return fresh.Select(row => row.Id).ToList();
            }
            catch (DbUpdateException exception) when (attempt < MaxPageAttempts && SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // Another event's page wrote one of these keys at the same moment (coalesced refresh
                // signals share keys across events) - this page rolls back, reads again and retries.
            }
            finally
            {
                dbContext.ChangeTracker.Clear();
            }
        }
    }

    private Task<int> MarkProcessedAsync(long eventId, long? cursor, DateTimeOffset nowUtc, CancellationToken cancellationToken) =>
        MarkCompletedAsync(eventId, NotificationEventStatus.Processed, cursor, null, nowUtc, cancellationToken);

    private Task<int> MarkCompletedAsync(
        long eventId, NotificationEventStatus status, long? cursor, string? errorCode, DateTimeOffset nowUtc, CancellationToken cancellationToken) =>
        dbContext.NotificationEvents
            .Where(entry => entry.Id == eventId && entry.Status == NotificationEventStatus.Pending)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(entry => entry.Status, status)
                    .SetProperty(entry => entry.CompletedAtUtc, nowUtc)
                    .SetProperty(entry => entry.LeaseUntilUtc, (DateTimeOffset?)null)
                    .SetProperty(entry => entry.NextAttemptAtUtc, (DateTimeOffset?)null)
                    .SetProperty(entry => entry.RecipientCursor, cursor)
                    .SetProperty(entry => entry.LastErrorCode, entry => errorCode ?? entry.LastErrorCode),
                cancellationToken);
}
