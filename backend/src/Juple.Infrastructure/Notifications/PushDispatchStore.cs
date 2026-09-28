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

        return new PushDispatchContext(
            true,
            actor is null ? null : string.IsNullOrWhiteSpace(actor.DisplayName) ? FormatJupleId(actor.PublicCode) : actor.DisplayName,
            collectionName,
            pendingFriendRequests + pendingInvitations);
    }

    public async Task MarkDispatchedAsync(long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
        await dbContext.Notifications
            .Where(notification => notification.Id == notificationId && notification.DispatchedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(notification => notification.DispatchedAtUtc, nowUtc), cancellationToken);

    /// <summary>Same "ABCD-EFGH" form the app shows.</summary>
    public static string FormatJupleId(string publicCode) =>
        publicCode.Length == 8 ? $"{publicCode[..4]}-{publicCode[4..]}" : publicCode;
}
