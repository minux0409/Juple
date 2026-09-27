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
