using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Images;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.DeleteAccount;

public sealed class AccountDeletionStore(JupleDbContext dbContext) : IAccountDeletionStore
{
    public async Task<long> DeleteAllDataAsync(
        long userId,
        string blobCleanupPrefix,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            // Registered FIRST, in the same transaction as the data deletion below - if that
            // deletion fails and rolls back, this task row rolls back with it too, so a failed
            // account deletion never leaves an orphan Blob cleanup task. Carries no UserId - see
            // AccountDeletionBlobCleanup's own remarks.
            var cleanupTask = new AccountDeletionBlobCleanup(blobCleanupPrefix, createdAtUtc);
            dbContext.AccountDeletionBlobCleanups.Add(cleanupTask);
            await dbContext.SaveChangesAsync(cancellationToken);

            // Every direct UserId FK in the schema is DeleteBehavior.NoAction except
            // ExternalIdentity (Cascade from User) - so each of these tables must be explicitly
            // cleared before the User row can be deleted. Each ExecuteDeleteAsync issues a single
            // real SQL DELETE, so SQL Server's own ON DELETE CASCADE constraints still fire for
            // the leaf tables below (NotificationDeliveries, ItemImages, CollectionItems,
            // CollectionShares) - they are never touched explicitly here.

            // Notifications -> cascades NotificationDeliveries. Also the ones this user caused for
            // other people (friend requests, invitations) - nothing about them stays behind.
            await dbContext.Notifications
                .Where(notification => notification.UserId == userId || notification.ActorUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Not-yet-processed (or kept for diagnosis) outbox events this user caused or is the one
            // recipient of - so nothing about them is materialized after the account is gone. Events
            // about their Collections are harmless (processing finds the Collection gone).
            await dbContext.NotificationEvents
                .Where(notificationEvent => notificationEvent.ActorUserId == userId
                    || notificationEvent.RecipientUserId == userId
                    || notificationEvent.SkipUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // PushDeviceRegistrations -> cascades any remaining NotificationDeliveries.
            await dbContext.PushDeviceRegistrations
                .Where(registration => registration.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // RepeatPurchases -> SetNulls any remaining Purchases.RepeatPurchaseId.
            await dbContext.RepeatPurchases
                .Where(repeatPurchase => repeatPurchase.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            await dbContext.Purchases
                .Where(purchase => purchase.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            await dbContext.RecentlyOpenedItems
                .Where(entry => entry.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Support inquiries and their answers are the deleted user's own content (UserId is NoAction).
            await dbContext.SupportInquiries
                .Where(inquiry => inquiry.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // CollectionMergeOperations has NoAction FKs to both Users and Collections (see
            // CollectionMergeOperationConfiguration) - must be cleared before either delete below,
            // or a user who ever merged a Collection could never delete their account. Cascades
            // away any remaining CollectionMergeCreatedMemberships rows with it.
            await dbContext.CollectionMergeOperations
                .Where(operation => operation.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Collaboration rows referencing this user through NoAction FKs, in either direction
            // (as the invitee/member, or as the Owner who invited/added someone). Rows of this
            // user's own Collections would also go with the Collections cascade below; clearing
            // them explicitly here keeps the User delete free of FK blockers either way.
            await dbContext.CollectionInvitations
                .Where(invitation => invitation.InvitedUserId == userId || invitation.InvitedByUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            await dbContext.CollectionCollaborators
                .Where(collaborator => collaborator.UserId == userId || collaborator.CreatedByUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Links this user added to anyone's Collection (AddedByUserId is NoAction). Their own
            // Items' associations would also cascade with the Items delete below.
            await dbContext.CollectionItems
                .Where(membership => membership.AddedByUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Links this user proposed to anyone's Collection and still waiting (SubmittedByUserId is
            // NoAction); proposals to their own Collections would also cascade below.
            await dbContext.CollectionLinkSubmissions
                .Where(submission => submission.SubmittedByUserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // This user's comments on anyone's links (UserId is NoAction); comments on their own
            // Collections' links would also cascade below. Leaving a Collection does NOT remove a
            // comment - only deleting the account does.
            await dbContext.CollectionItemComments
                .Where(comment => comment.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // This user's emoji reactions on anyone's links (UserId is NoAction); reactions on their own
            // Collections' links would also cascade below.
            await dbContext.CollectionItemReactions
                .Where(reaction => reaction.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // This user's personal favorite marks, including on other people's Collections (marks on
            // their own Collections would also cascade with the Collections delete below).
            await dbContext.CollectionFavorites
                .Where(favorite => favorite.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // This user's own per-Collection notification settings, including on other people's
            // Collections (settings on their own Collections would also cascade below).
            await dbContext.CollectionNotificationPreferences
                .Where(preference => preference.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Friend requests and friendships in either direction; both private notes on each go
            // with them (Cascade). The other people's accounts and Collections are untouched -
            // unlike removing one friend, this clears every friendship of the deleted user.
            await dbContext.Friendships
                .Where(friendship => friendship.UserLowId == userId || friendship.UserHighId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Failed-unlock counters keyed to this user on other people's Collections (their own
            // Collections' counters cascade with the Collections delete).
            var userThrottleKey = $"u:{userId}";
            await dbContext.CollectionUnlockThrottles
                .Where(throttle => throttle.SubjectKey == userThrottleKey)
                .ExecuteDeleteAsync(cancellationToken);

            // This user's single Collection lock password (NoAction FK to Users).
            await dbContext.UserCollectionLockSettings
                .Where(settings => settings.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Collections -> cascades CollectionItems, CollectionShares, CollectionCollaborators,
            // CollectionInvitations, CollectionUnlockThrottles and other people's CollectionFavorites. This is what makes this user's
            // public share links stop resolving.
            await dbContext.Collections
                .Where(collection => collection.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // Items -> cascades ItemImages and any remaining CollectionItems/RecentlyOpenedItems.
            await dbContext.Items
                .Where(item => item.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // ItemSaveRequests.ItemId is a historical value, not an FK - order relative to Items
            // above does not matter.
            await dbContext.ItemSaveRequests
                .Where(request => request.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken);

            // User -> cascades ExternalIdentities. Every other owned table has already been
            // emptied above, so this cannot violate any FK.
            await dbContext.Users
                .Where(user => user.Id == userId)
                .ExecuteDeleteAsync(cancellationToken);

            await transaction.CommitAsync(cancellationToken);
            return cleanupTask.Id;
        }
        catch
        {
            await transaction.RollbackAsync(cancellationToken);
            throw;
        }
    }
}
