using Juple.Application.Images;

namespace Juple.Application.Retention;

public interface IRetentionCleanupService
{
    Task<RetentionCleanupResult> RunAsync(CancellationToken cancellationToken = default);
}

/// <summary>What one pass did, per category: how many rows were removed, and whether the category stopped on an error.</summary>
public sealed record RetentionCategoryResult(string Category, int Purged, int Batches, bool HitBatchLimit, string? ErrorType);

public sealed record RetentionCleanupResult(IReadOnlyList<RetentionCategoryResult> Categories)
{
    public int TotalPurged => Categories.Sum(category => category.Purged);

    public bool HasFailures => Categories.Any(category => category.ErrorType is not null);
}

/// <summary>
/// One scheduled pass over everything that must not be kept forever (see RetentionOptions for the periods). It runs each category in
/// bounded batches and keeps going when one fails, so a problem in one kind of data never stops the others; the next run simply
/// continues, because every purge step is conditional and repeatable. Nothing here decides what is "live": each store method only
/// selects data that is past its period AND no longer in use.
/// </summary>
public sealed class RetentionCleanupService(
    IRetentionStore store,
    IItemImageStorage itemImageStorage,
    RetentionOptions options,
    TimeProvider timeProvider) : IRetentionCleanupService
{
    public async Task<RetentionCleanupResult> RunAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var results = new List<RetentionCategoryResult>();

        // Order matters only where one kind references another: merge history before the Collections it points at.
        results.Add(await RunCategoryAsync("trialLedger", batch =>
            store.DeleteTrialLedgerEntriesEndedBeforeAsync(now.AddMonths(-options.TrialLedgerMonthsAfterTrialEnd), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("purchaseSealedTokens", batch =>
            store.ClearSealedPurchaseTokensAsync(now.AddDays(-options.SealedPurchaseTokenDaysAfterAccessEnd), now, batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("purchaseRecords", batch =>
            store.DeleteEndedPurchaseRecordsAsync(now.AddYears(-options.PurchaseRecordYearsAfterAccessEnd), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("processedBillingEvents", batch =>
            store.DeleteProcessedStoreEventsAsync(now.AddDays(-options.ProcessedBillingEventDays), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("mergeUndoHistory", batch =>
            store.DeleteMergeOperationsAsync(now.AddDays(-options.SoftDeletedCollectionDays), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("softDeletedCollections", batch =>
            store.DeleteSoftDeletedCollectionsAsync(now.AddDays(-options.SoftDeletedCollectionDays), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("notifications", batch =>
            store.DeleteNotificationsAsync(now.AddDays(-options.NotificationDays), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("stalePushTokens", batch =>
            store.DeleteStalePushRegistrationsAsync(now.AddDays(-options.StalePushTokenDays), batch, cancellationToken), cancellationToken));
        results.Add(await RunCategoryAsync("trashItems", async batch =>
        {
            var purged = await store.DeleteExpiredTrashItemsAsync(now.AddDays(-options.TrashDays), batch, cancellationToken);
            foreach (var item in purged)
            {
                await DeleteBlobsBestEffortAsync(item, cancellationToken);
            }

            return purged.Count;
        }, cancellationToken));

        return new RetentionCleanupResult(results);
    }

    private async Task<RetentionCategoryResult> RunCategoryAsync(string category, Func<int, Task<int>> purgeBatch, CancellationToken cancellationToken)
    {
        var total = 0;
        var batches = 0;
        try
        {
            while (batches < options.MaxBatchesPerCategory)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var handled = await purgeBatch(options.BatchSize);
                batches++;
                total += handled;
                if (handled < options.BatchSize)
                {
                    return new RetentionCategoryResult(category, total, batches, HitBatchLimit: false, ErrorType: null);
                }
            }

            return new RetentionCategoryResult(category, total, batches, HitBatchLimit: true, ErrorType: null);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            // What was already removed stays removed (each batch is its own transaction); the next run continues from here.
            return new RetentionCategoryResult(category, total, batches, HitBatchLimit: false, ErrorType: exception.GetType().Name);
        }
    }

    private async Task DeleteBlobsBestEffortAsync(PurgedItem item, CancellationToken cancellationToken)
    {
        try
        {
            await itemImageStorage.DeleteItemBlobsAsync(item.UserId, item.ItemId, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Same stance as every other item purge: the row is gone, a Blob that could not be removed now is an orphan, never a failure of the pass.
        }
    }
}
