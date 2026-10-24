using Juple.Application.Collections;
using Juple.Application.Collections.ShareLink;
using Juple.Application.Notifications;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Safety;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionLinkShareStore(JupleDbContext dbContext, INotificationSignal? signal = null) : ICollectionLinkShareStore
{
    public async Task<IReadOnlyCollection<long>> EnqueueAsync(
        long senderUserId,
        long collectionId,
        IReadOnlyCollection<long> recipientUserIds,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        // The same row lock enabling the link and every invitation takes, so this check and the
        // records below are one decision against the Collection as it is now.
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken);
        var share = await dbContext.CollectionShares.AsNoTracking()
            .FirstOrDefaultAsync(share => share.CollectionId == collectionId && share.IsActive, cancellationToken);
        if (ownerUserId is null || share is null)
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.PublicLinkInactive);
        if (ownerUserId != senderUserId && !await dbContext.CollectionCollaborators.AnyAsync(
            member => member.CollectionId == collectionId && member.UserId == senderUserId, cancellationToken))
            throw new CollectionForbiddenException();
        if (await dbContext.CollectionSharePasswords.AnyAsync(password => password.CollectionId == collectionId
            && password.Mode == CollectionSharePasswordMode.LegacyCommonLock, cancellationToken))
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.SharePasswordMigrationRequired);

        // Someone who already belongs (Owner, member) or holds a live invitation gets nothing - decided under the lock.
        var distinct = recipientUserIds.Distinct().ToList();
        var memberIds = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == collectionId && distinct.Contains(collaborator.UserId))
            .Select(collaborator => collaborator.UserId)
            .ToListAsync(cancellationToken);
        var invitedIds = await dbContext.CollectionInvitations.AsNoTracking()
            .Where(invitation => invitation.CollectionId == collectionId
                && invitation.Status == CollectionInvitationStatus.Pending
                && invitation.ExpiresAtUtc > nowUtc
                && distinct.Contains(invitation.InvitedUserId))
            .Select(invitation => invitation.InvitedUserId)
            .ToListAsync(cancellationToken);
        var skipped = memberIds.Concat(invitedIds).Concat(distinct.Where(id => id == ownerUserId)).Distinct().ToList();
        var eligible = distinct.Where(id => !skipped.Contains(id)).ToList();

        // The same durable invitation rows and notification target as an owner invitation.
        // A member is only a referrer: private acceptance still requires the owner's approval.
        var invitations = new List<CollectionInvitation>();
        foreach (var recipient in eligible)
        {
            try
            {
                await BlockGuard.EnsureNotBlockedAsync(dbContext, senderUserId, recipient, cancellationToken);
                await BlockGuard.EnsureNotBlockedAsync(dbContext, ownerUserId.Value, recipient, cancellationToken);
            }
            catch (Juple.Application.Safety.UserBlockedException)
            {
                skipped.Add(recipient); // Generic skipped result never discloses the block direction.
                continue;
            }
            foreach (var expired in await dbContext.CollectionInvitations.Where(invitation =>
                invitation.CollectionId == collectionId && invitation.InvitedUserId == recipient
                && invitation.Status == CollectionInvitationStatus.Pending).ToListAsync(cancellationToken))
                expired.MarkExpired(nowUtc);
            invitations.Add(new CollectionInvitation(collectionId, recipient, senderUserId,
                senderUserId == ownerUserId && share.IsPublic ? PublicShareRoles.MinimumFor(share.Permission) : CollectionCollaboratorRole.Viewer, nowUtc));
        }
        // Release expired rows from the filtered unique index before inserting replacements.
        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.CollectionInvitations.AddRange(invitations);
        await dbContext.SaveChangesAsync(cancellationToken);
        var events = invitations.Select(invitation => new NotificationEvent(
            NotificationType.CollectionInvitationReceived, senderUserId, invitation.InvitedUserId,
            collectionId, invitation.Id, null, false, null, NotificationEventKeys.CollectionInvitationReceived(invitation.Id), nowUtc)).ToList();
        dbContext.NotificationEvents.AddRange(events);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        if (signal is not null && !transaction.IsJoined && events.Count > 0)
        {
            await signal.SignalEventsAsync(events.Select(entry => entry.Id).ToList(), CancellationToken.None);
        }

        return skipped;
    }
}
