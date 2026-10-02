using Juple.Application.Notifications;
using Juple.Domain.Collections;
using Juple.Domain.Friends;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

public sealed class PushDispatchStore(JupleDbContext dbContext) : IPushDispatchStore
{
    public async Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, CancellationToken cancellationToken = default) =>
        await dbContext.Notifications
            .AsNoTracking()
            .Where(notification => notification.DispatchedAtUtc == null && notification.DedupKey != null)
            .OrderBy(notification => notification.CreatedAtUtc)
            .ThenBy(notification => notification.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task<PushDispatchContext> GetContextAsync(Notification notification, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var userId = notification.UserId;
        var isRelevant = notification.Type switch
        {
            // Still an unanswered request from that same person to this recipient.
            NotificationType.FriendRequestReceived => await dbContext.Friendships.AnyAsync(
                friendship => friendship.Id == notification.SubjectId
                    && friendship.Status == FriendshipStatus.Pending
                    && friendship.RequestedByUserId == notification.ActorUserId
                    && (friendship.UserLowId == userId || friendship.UserHighId == userId),
                cancellationToken),
            NotificationType.CollectionInvitationReceived => await dbContext.CollectionInvitations.AnyAsync(
                invitation => invitation.Id == notification.SubjectId
                    && invitation.InvitedUserId == userId
                    && invitation.Status == CollectionInvitationStatus.Pending
                    && invitation.ExpiresAtUtc > nowUtc,
                cancellationToken),
            // Refresh signals: only while the recipient still owns / belongs to that Collection.
            NotificationType.CollectionInvitationAnswered or NotificationType.CollectionContentChanged =>
                await dbContext.Collections.AnyAsync(
                    collection => collection.Id == notification.CollectionId
                        && collection.DeletedAtUtc == null
                        && (collection.UserId == userId
                            || dbContext.CollectionCollaborators.Any(
                                collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)),
                    cancellationToken),
            // Still the Owner / a member, and 새 링크 알림 not turned off since it was enqueued.
            NotificationType.CollectionItemsAdded =>
                await dbContext.Collections.AnyAsync(
                    collection => collection.Id == notification.CollectionId
                        && collection.DeletedAtUtc == null
                        && (collection.UserId == userId
                            || dbContext.CollectionCollaborators.Any(
                                collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)),
                    cancellationToken)
                && !await dbContext.CollectionNotificationPreferences.AnyAsync(
                    preference => preference.CollectionId == notification.CollectionId
                        && preference.UserId == userId
                        && !preference.NewItemNotificationsEnabled,
                    cancellationToken),
            // A passed-on public link: only while that link is still on (and the Collection exists).
            NotificationType.CollectionLinkShared => await dbContext.CollectionShares.AnyAsync(
                share => share.CollectionId == notification.CollectionId
                    && share.IsActive
                    && dbContext.Collections.Any(collection => collection.Id == share.CollectionId && collection.DeletedAtUtc == null),
                cancellationToken),
            // A reaction/comment on the recipient's own link: only while that link is still in the
            // Collection, the recipient still owns or belongs to it, and what the actor left is still
            // there (a reaction taken back, or a comment deleted, is not announced late).
            NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived =>
                await IsOwnLinkInCollectionAsync(notification, cancellationToken)
                && (notification.Type == NotificationType.CollectionItemReactionReceived
                    ? await dbContext.CollectionItemReactions.AnyAsync(
                        reaction => reaction.CollectionId == notification.CollectionId
                            && reaction.ItemId == notification.SubjectId
                            && reaction.UserId == notification.ActorUserId,
                        cancellationToken)
                    : await dbContext.CollectionItemComments.AnyAsync(
                        comment => comment.CollectionId == notification.CollectionId
                            && comment.ItemId == notification.SubjectId
                            && comment.UserId == notification.ActorUserId,
                        cancellationToken)),
            // The proposal still waits for this recipient - still the Collection's Owner.
            NotificationType.CollectionLinkSubmissionReceived => await dbContext.CollectionLinkSubmissions.AnyAsync(
                submission => submission.Id == notification.SubjectId
                    && submission.CollectionId == notification.CollectionId
                    && dbContext.Collections.Any(
                        collection => collection.Id == submission.CollectionId && collection.DeletedAtUtc == null && collection.UserId == userId),
                cancellationToken),
            // The result of the recipient's own proposal stays true; only a deleted Collection makes it moot.
            NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected =>
                await dbContext.Collections.AnyAsync(
                    collection => collection.Id == notification.CollectionId && collection.DeletedAtUtc == null,
                    cancellationToken),
            // Refresh signal about the recipient's own (now answered, possibly deleted) request:
            // there is nothing left to re-check - the payload carries no id, only the type.
            NotificationType.FriendRequestAnswered => true,
            _ => false,
        };
        if (!isRelevant)
        {
            return new PushDispatchContext(false, null, null, 0);
        }

        var actor = notification.ActorUserId is { } actorUserId
            ? await dbContext.Users.AsNoTracking()
                .Where(user => user.Id == actorUserId)
                .Select(user => new { user.DisplayName, user.PublicCode })
                .FirstOrDefaultAsync(cancellationToken)
            : null;
        var collectionName = notification.CollectionId is { } collectionId
            ? await dbContext.Collections.AsNoTracking()
                .Where(collection => collection.Id == collectionId)
                .Select(collection => collection.Name)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        var pendingFriendRequests = await dbContext.Friendships.CountAsync(
            friendship => friendship.Status == FriendshipStatus.Pending
                && friendship.RequestedByUserId != userId
                && (friendship.UserLowId == userId || friendship.UserHighId == userId),
            cancellationToken);
        var pendingInvitations = await dbContext.CollectionInvitations.CountAsync(
            invitation => invitation.InvitedUserId == userId
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc,
            cancellationToken);

        // A proposal's result goes to whoever proposed - possibly through the public link, as no
        // member: the push may open the Collection itself only for someone who owns or belongs to it,
        // else its public link while that is on, else nothing (the app just opens).
        var isProposalResult = notification.Type
            is NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected;
        var recipientBelongs = !isProposalResult
            || await dbContext.Collections.AnyAsync(
                collection => collection.Id == notification.CollectionId
                    && (collection.UserId == userId
                        || dbContext.CollectionCollaborators.Any(
                            collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)),
                cancellationToken);

        var publicShareId = notification.Type == NotificationType.CollectionLinkShared || (isProposalResult && !recipientBelongs)
            ? await dbContext.CollectionShares.AsNoTracking()
                .Where(share => share.CollectionId == notification.CollectionId && share.IsActive)
                .Select(share => share.PublicId)
                .FirstOrDefaultAsync(cancellationToken)
            : null;

        return new PushDispatchContext(
            true,
            actor is null ? null : string.IsNullOrWhiteSpace(actor.DisplayName) ? FormatJupleId(actor.PublicCode) : actor.DisplayName,
            collectionName,
            pendingFriendRequests + pendingInvitations,
            publicShareId,
            recipientBelongs);
    }

    /// <summary>The notification's link (SubjectId) is the recipient's own live Item, still in that live Collection, which the recipient still owns or belongs to.</summary>
    private Task<bool> IsOwnLinkInCollectionAsync(Notification notification, CancellationToken cancellationToken)
    {
        var userId = notification.UserId;
        return (
            from membership in dbContext.CollectionItems
            where membership.CollectionId == notification.CollectionId && membership.ItemId == notification.SubjectId
            join item in dbContext.Items on membership.ItemId equals item.Id
            where item.DeletedAtUtc == null && item.UserId == userId
            join collection in dbContext.Collections on membership.CollectionId equals collection.Id
            where collection.DeletedAtUtc == null
                && (collection.UserId == userId
                    || dbContext.CollectionCollaborators.Any(
                        collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId))
            select membership.Id).AnyAsync(cancellationToken);
    }

    public async Task MarkDispatchedAsync(long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        await dbContext.Notifications
            .Where(notification => notification.Id == notificationId && notification.DispatchedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.DispatchedAtUtc, nowUtc), cancellationToken);

    /// <summary>Same "ABCD-EFGH" form the app shows.</summary>
    public static string FormatJupleId(string publicCode) =>
        publicCode.Length == 8 ? $"{publicCode[..4]}-{publicCode[4..]}" : publicCode;
}
