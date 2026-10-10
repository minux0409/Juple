namespace Juple.Application.Retention;

/// <summary>
/// The ONE place retention periods are written (section "Retention"; every value can be overridden by configuration, nothing else
/// in the code carries a retention number). The defaults are the working policy in docs/data-retention.md.
///
/// The billing-record periods (<see cref="SealedPurchaseTokenDaysAfterAccessEnd"/> and <see cref="PurchaseRecordYearsAfterAccessEnd"/>)
/// and <see cref="TrialLedgerMonthsAfterTrialEnd"/> are WORKING values pending legal/accounting review - in particular the 5 years
/// for the purchase record. Change them here (or by configuration), not in the cleanup.
/// </summary>
public sealed class RetentionOptions
{
    public const string SectionName = "Retention";

    /// <summary>A trial-ledger entry is deleted this many months after its trial window ended. A trial still running is never touched.</summary>
    public int TrialLedgerMonthsAfterTrialEnd { get; set; } = 24;

    /// <summary>
    /// The sealed Google purchase token of an ENDED purchase (expired or revoked) is removed this many days after its access ended.
    /// A purchase whose access is live, on hold, paused, pending or being re-checked is never touched.
    /// </summary>
    public int SealedPurchaseTokenDaysAfterAccessEnd { get; set; } = 180;

    /// <summary>
    /// The token hash and minimal state/dates of an ENDED purchase (the row itself) are deleted this many years after its access ended.
    /// WORKING VALUE - legal/accounting review required.
    /// </summary>
    public int PurchaseRecordYearsAfterAccessEnd { get; set; } = 5;

    /// <summary>A processed store notification (RTDN) row is deleted this many days after it was processed.</summary>
    public int ProcessedBillingEventDays { get; set; } = 90;

    /// <summary>A soft-deleted Collection, and merge-undo history, is deleted for good after this many days.</summary>
    public int SoftDeletedCollectionDays { get; set; } = 30;

    /// <summary>An in-app notification is deleted this many days after it was created.</summary>
    public int NotificationDays { get; set; } = 90;

    /// <summary>A push device registration not seen for this many days is deleted.</summary>
    public int StalePushTokenDays { get; set; } = 180;

    /// <summary>A link in the trash (삭제 이력) is deleted for good this many days after it was deleted - in addition to the per-user cap (ItemTrashLimits).</summary>
    public int TrashDays { get; set; } = 30;

    /// <summary>Rows handled per statement; each batch is its own short transaction.</summary>
    public int BatchSize { get; set; } = 500;

    /// <summary>The most batches one category may run in one pass (the next scheduled run continues) - a run is always bounded.</summary>
    public int MaxBatchesPerCategory { get; set; } = 200;
}

public static class RetentionOptionsValidator
{
    /// <summary>Every period must be positive: a zero or negative value would purge live data, so it stops the Job at startup.</summary>
    public static void Validate(RetentionOptions options)
    {
        Require(options.TrialLedgerMonthsAfterTrialEnd, nameof(options.TrialLedgerMonthsAfterTrialEnd));
        Require(options.SealedPurchaseTokenDaysAfterAccessEnd, nameof(options.SealedPurchaseTokenDaysAfterAccessEnd));
        Require(options.PurchaseRecordYearsAfterAccessEnd, nameof(options.PurchaseRecordYearsAfterAccessEnd));
        Require(options.ProcessedBillingEventDays, nameof(options.ProcessedBillingEventDays));
        Require(options.SoftDeletedCollectionDays, nameof(options.SoftDeletedCollectionDays));
        Require(options.NotificationDays, nameof(options.NotificationDays));
        Require(options.StalePushTokenDays, nameof(options.StalePushTokenDays));
        Require(options.TrashDays, nameof(options.TrashDays));
        Require(options.BatchSize, nameof(options.BatchSize));
        Require(options.MaxBatchesPerCategory, nameof(options.MaxBatchesPerCategory));

        // The token is removed before the row; the other order would delete the row while its token is still being kept.
        if (options.PurchaseRecordYearsAfterAccessEnd * 365 <= options.SealedPurchaseTokenDaysAfterAccessEnd)
        {
            throw new InvalidOperationException(
                $"{RetentionOptions.SectionName}:{nameof(options.PurchaseRecordYearsAfterAccessEnd)} must be longer than {nameof(options.SealedPurchaseTokenDaysAfterAccessEnd)}.");
        }
    }

    private static void Require(int value, string name)
    {
        if (value < 1)
        {
            throw new InvalidOperationException($"{RetentionOptions.SectionName}:{name} must be at least 1.");
        }
    }
}
