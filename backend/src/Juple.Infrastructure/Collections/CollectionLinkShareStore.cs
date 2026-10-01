using Juple.Application.Collections;
using Juple.Application.Collections.ShareLink;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionLinkShareStore(JupleDbContext dbContext) : ICollectionLinkShareStore
{
    public async Task EnqueueAsync(
        long senderUserId,
        long collectionId,
        IReadOnlyCollection<long> recipientUserIds,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        // The same row lock enabling the link and every invitation takes, so this check and the
        // records below are one decision against the Collection as it is now.
        var isPublic = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken) is not null
            && await dbContext.CollectionShares.AnyAsync(share => share.CollectionId == collectionId && share.IsActive, cancellationToken);
        if (!isPublic)
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicLinkInactive);
        }

        // One notification per recipient and send - sending again later is a new notification.
        var operationId = Guid.NewGuid();
        foreach (var recipientUserId in recipientUserIds.Distinct())
        {
            dbContext.Notifications.Add(Notification.Social(
                recipientUserId, NotificationType.CollectionLinkShared, senderUserId, collectionId, null,
                $"collection-link:{collectionId}:{recipientUserId}:{operationId:N}", nowUtc));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }
}
