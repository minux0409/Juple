using Juple.Application.Collections;
using Juple.Application.Collections.ShareLink;
using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionLinkShareStore(JupleDbContext dbContext, INotificationSignal? signal = null) : ICollectionLinkShareStore
{
    public async Task EnqueueAsync(
        long senderUserId,
        long collectionId,
        IReadOnlyCollection<long> recipientUserIds,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        // The same row lock enabling the link and every invitation takes, so this check and the
        // records below are one decision against the Collection as it is now.
        var isPublic = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) is not null
            && await dbContext.CollectionShares.AnyAsync(share => share.CollectionId == collectionId && share.IsActive, cancellationToken);
        if (!isPublic)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicLinkInactive);
        }

        // One outbox event per recipient and send (a bounded few - see ShareCollectionLinkService) -
        // sending again later is a new notification. They commit with this decision.
        var events = recipientUserIds.Distinct()
            .Select(recipientUserId => new NotificationEvent(
                NotificationType.CollectionLinkShared, senderUserId, recipientUserId, collectionId, null, null, false, null, null, nowUtc))
            .ToList();
        dbContext.NotificationEvents.AddRange(events);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        if (signal is not null && !transaction.IsJoined)
        {
            await signal.SignalEventsAsync(events.Select(entry => entry.Id).ToList(), CancellationToken.None);
        }
    }
}
