namespace Juple.Application.Retention;

/// <summary>
/// One bounded purge step per kind of data. Every method handles AT MOST <c>batchSize</c> rows in its own short transaction, returns
/// how many it handled, and is safe to repeat: the condition that selects a row is re-checked inside the same statement that changes
/// it, so a row that became live again in between (restored, re-linked, re-activated) is simply not touched, and a row can never
/// be handled twice. Live data is excluded by the conditions themselves, not by the caller.
/// </summary>
public interface IRetentionStore
{
    /// <summary>Deletes trial-ledger entries whose trial window ended before the cutoff.</summary>
    Task<int> DeleteTrialLedgerEntriesEndedBeforeAsync(DateTimeOffset trialEndedBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Removes the sealed token (keeping the row, hash and state) of ended purchases whose access ended before the cutoff.</summary>
    Task<int> ClearSealedPurchaseTokensAsync(DateTimeOffset accessEndedBeforeUtc, DateTimeOffset nowUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes ended purchases whose access ended before the cutoff.</summary>
    Task<int> DeleteEndedPurchaseRecordsAsync(DateTimeOffset accessEndedBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes processed store notifications processed before the cutoff.</summary>
    Task<int> DeleteProcessedStoreEventsAsync(DateTimeOffset processedBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes merge-undo history created before the cutoff (it must go before the Collections it references).</summary>
    Task<int> DeleteMergeOperationsAsync(DateTimeOffset createdBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes Collections soft-deleted before the cutoff, with everything that belongs to them.</summary>
    Task<int> DeleteSoftDeletedCollectionsAsync(DateTimeOffset deletedBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes in-app notifications created before the cutoff.</summary>
    Task<int> DeleteNotificationsAsync(DateTimeOffset createdBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes push registrations not seen since the cutoff.</summary>
    Task<int> DeleteStalePushRegistrationsAsync(DateTimeOffset lastSeenBeforeUtc, int batchSize, CancellationToken cancellationToken = default);

    /// <summary>Deletes trashed links deleted before the cutoff and returns who owned them, so their Blobs can be removed.</summary>
    Task<IReadOnlyList<PurgedItem>> DeleteExpiredTrashItemsAsync(DateTimeOffset deletedBeforeUtc, int batchSize, CancellationToken cancellationToken = default);
}

public sealed record PurgedItem(long UserId, long ItemId);
