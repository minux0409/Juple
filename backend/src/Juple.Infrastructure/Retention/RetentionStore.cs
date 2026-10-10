using Juple.Application.Retention;
using Juple.Domain.Billing;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Retention;

/// <summary>
/// The purge steps (see <see cref="IRetentionStore"/>). Every step picks at most one batch of ids (oldest first), then changes exactly
/// those rows with ONE set-based statement that repeats the selecting condition - so a row that stopped qualifying between the two
/// (restored, re-linked, re-activated, re-opened) is skipped by the database itself, and re-running after any failure is harmless.
/// Each statement is its own transaction; nothing here ever spans batches.
/// </summary>
public sealed class RetentionStore(JupleDbContext dbContext) : IRetentionStore
{
    public async Task<int> DeleteTrialLedgerEntriesEndedBeforeAsync(DateTimeOffset trialEndedBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // A trial that has not ended has TrialEndsAtUtc in the future, so it can never satisfy the condition.
        var ids = await dbContext.TrialLedger.AsNoTracking()
            .Where(entry => entry.TrialEndsAtUtc < trialEndedBeforeUtc)
            .OrderBy(entry => entry.TrialEndsAtUtc).ThenBy(entry => entry.Id)
            .Select(entry => entry.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.TrialLedger.Where(entry => ids.Contains(entry.Id) && entry.TrialEndsAtUtc < trialEndedBeforeUtc).ExecuteDeleteAsync(cancellationToken);
    }

    // "Ended" = the store says the purchase is over (Expired, or Revoked/refunded). OnHold, Paused, Pending and every live state are
    // excluded on purpose: they can come back or are still being re-checked. The reference time is the instant access ended; a
    // purchase that never granted access falls back to the last time it was verified.
    public async Task<int> ClearSealedPurchaseTokensAsync(DateTimeOffset accessEndedBeforeUtc, DateTimeOffset nowUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        var ids = await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.VerificationHandleEncrypted != null
                && (purchase.State == StorePurchaseState.Expired || purchase.State == StorePurchaseState.Revoked)
                && (purchase.AccessEndsAtUtc ?? purchase.LatestVerifiedAtUtc) < accessEndedBeforeUtc)
            .OrderBy(purchase => purchase.Id)
            .Select(purchase => purchase.Id).Take(batchSize).ToListAsync(cancellationToken);
        if (ids.Count == 0)
        {
            return 0;
        }

        return await dbContext.StorePurchases
            .Where(purchase => ids.Contains(purchase.Id)
                && purchase.VerificationHandleEncrypted != null
                && (purchase.State == StorePurchaseState.Expired || purchase.State == StorePurchaseState.Revoked)
                && (purchase.AccessEndsAtUtc ?? purchase.LatestVerifiedAtUtc) < accessEndedBeforeUtc)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(purchase => purchase.VerificationHandleEncrypted, (byte[]?)null)
                    .SetProperty(purchase => purchase.VerificationHandlePurgedAtUtc, nowUtc)
                    .SetProperty(purchase => purchase.UpdatedAtUtc, nowUtc),
                cancellationToken);
    }

    public async Task<int> DeleteEndedPurchaseRecordsAsync(DateTimeOffset accessEndedBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        var ids = await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => (purchase.State == StorePurchaseState.Expired || purchase.State == StorePurchaseState.Revoked)
                && (purchase.AccessEndsAtUtc ?? purchase.LatestVerifiedAtUtc) < accessEndedBeforeUtc)
            .OrderBy(purchase => purchase.Id)
            .Select(purchase => purchase.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.StorePurchases
                .Where(purchase => ids.Contains(purchase.Id)
                    && (purchase.State == StorePurchaseState.Expired || purchase.State == StorePurchaseState.Revoked)
                    && (purchase.AccessEndsAtUtc ?? purchase.LatestVerifiedAtUtc) < accessEndedBeforeUtc)
                .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteProcessedStoreEventsAsync(DateTimeOffset processedBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        var ids = await dbContext.StoreEvents.AsNoTracking()
            .Where(storeEvent => storeEvent.ProcessedAtUtc != null && storeEvent.ProcessedAtUtc < processedBeforeUtc)
            .OrderBy(storeEvent => storeEvent.ProcessedAtUtc).ThenBy(storeEvent => storeEvent.Id)
            .Select(storeEvent => storeEvent.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.StoreEvents
                .Where(storeEvent => ids.Contains(storeEvent.Id) && storeEvent.ProcessedAtUtc != null && storeEvent.ProcessedAtUtc < processedBeforeUtc)
                .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteMergeOperationsAsync(DateTimeOffset createdBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // Cascades the memberships that merge created (CollectionMergeCreatedMemberships); the merged data itself is not touched.
        var ids = await dbContext.CollectionMergeOperations.AsNoTracking()
            .Where(operation => operation.CreatedAtUtc < createdBeforeUtc)
            .OrderBy(operation => operation.CreatedAtUtc).ThenBy(operation => operation.Id)
            .Select(operation => operation.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.CollectionMergeOperations
                .Where(operation => ids.Contains(operation.Id) && operation.CreatedAtUtc < createdBeforeUtc)
                .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteSoftDeletedCollectionsAsync(DateTimeOffset deletedBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // A restored Collection has DeletedAtUtc null again, so the repeated condition skips it. Merge history that points at a
        // Collection is older than the Collection's deletion, so it was removed by the step before; a reference that is somehow
        // still there makes this statement fail for that batch (NoAction FK) and the category reports the error - never a partial delete.
        var ids = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.DeletedAtUtc != null && collection.DeletedAtUtc < deletedBeforeUtc)
            .OrderBy(collection => collection.DeletedAtUtc).ThenBy(collection => collection.Id)
            .Select(collection => collection.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.Collections
                .Where(collection => ids.Contains(collection.Id) && collection.DeletedAtUtc != null && collection.DeletedAtUtc < deletedBeforeUtc)
                .ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteNotificationsAsync(DateTimeOffset createdBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // Cascades the notification's push delivery rows.
        var ids = await dbContext.Notifications.AsNoTracking()
            .Where(notification => notification.CreatedAtUtc < createdBeforeUtc)
            .OrderBy(notification => notification.CreatedAtUtc).ThenBy(notification => notification.Id)
            .Select(notification => notification.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.Notifications.Where(notification => ids.Contains(notification.Id) && notification.CreatedAtUtc < createdBeforeUtc).ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<int> DeleteStalePushRegistrationsAsync(DateTimeOffset lastSeenBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // A device that opens the app re-registers and moves LastSeenAtUtc forward, so an active device never matches.
        var ids = await dbContext.PushDeviceRegistrations.AsNoTracking()
            .Where(registration => registration.LastSeenAtUtc < lastSeenBeforeUtc)
            .OrderBy(registration => registration.LastSeenAtUtc).ThenBy(registration => registration.Id)
            .Select(registration => registration.Id).Take(batchSize).ToListAsync(cancellationToken);
        return ids.Count == 0
            ? 0
            : await dbContext.PushDeviceRegistrations.Where(registration => ids.Contains(registration.Id) && registration.LastSeenAtUtc < lastSeenBeforeUtc).ExecuteDeleteAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<PurgedItem>> DeleteExpiredTrashItemsAsync(DateTimeOffset deletedBeforeUtc, int batchSize, CancellationToken cancellationToken = default)
    {
        // Tracked on purpose: the delete carries the row's version, so a link restored (or otherwise changed) after it was read makes
        // the batch fail with a concurrency error instead of deleting it - and the list returned is exactly what was deleted, which is
        // what lets the caller remove those photos without ever touching a link that is still alive.
        dbContext.ChangeTracker.Clear();
        try
        {
            var expired = await dbContext.Items
                .Where(item => item.DeletedAtUtc != null && item.DeletedAtUtc < deletedBeforeUtc)
                .OrderBy(item => item.DeletedAtUtc).ThenBy(item => item.Id)
                .Take(batchSize)
                .ToListAsync(cancellationToken);
            if (expired.Count == 0)
            {
                return [];
            }

            dbContext.Items.RemoveRange(expired);
            await dbContext.SaveChangesAsync(cancellationToken);
            return expired.Select(item => new PurgedItem(item.UserId, item.Id)).ToList();
        }
        finally
        {
            dbContext.ChangeTracker.Clear();
        }
    }
}
