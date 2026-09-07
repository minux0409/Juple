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

            // Notifications -> cascades NotificationDeliveries.
            await dbContext.Notifications
                .Where(notification => notification.UserId == userId)
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

            // Collections -> cascades CollectionItems and CollectionShares. This is what makes
            // this user's public share links stop resolving.
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
