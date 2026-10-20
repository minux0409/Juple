using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

/// <summary>Which retention notice goes out when, its idempotency key, and the "never delete without the final notice" rule.</summary>
public sealed class DataRetentionNoticesTests
{
    private static readonly DateTimeOffset Effective = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset PaidEnd = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);

    private static DataRetentionState At(DateTimeOffset now, StorePurchaseState state = StorePurchaseState.Expired, DateTimeOffset? end = null) =>
        DataRetentionPolicy.Evaluate(new DataRetentionInput(true, Effective, Effective.AddDays(-30), null, [new PurchaseAccess(state, EntitlementReason.None, end ?? PaidEnd)]), now);

    [Fact]
    public void EachNoticeIsSentOnce_AtItsInstant_InOrder()
    {
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(3).AddTicks(-1)), []));
        Assert.Equal(DataRetentionNotice.RetentionEnding, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(3)), []));
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(4)), [DataRetentionNotice.RetentionEnding]));
        Assert.Equal(DataRetentionNotice.DeletionScheduled, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(5)), [DataRetentionNotice.RetentionEnding]));
        Assert.Equal(DataRetentionNotice.FinalNotice, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(6).AddDays(-7)), [DataRetentionNotice.RetentionEnding, DataRetentionNotice.DeletionScheduled]));
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(6)), [DataRetentionNotice.FinalNotice]));
    }

    [Fact]
    public void AJobThatWasDown_SendsOnlyTheCurrentNotice_NeverAStaleBacklog()
    {
        Assert.Equal(DataRetentionNotice.FinalNotice, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(6).AddDays(-2)), []));
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(5)), [DataRetentionNotice.FinalNotice]));
    }

    [Fact]
    public void NothingIsSent_WhileLive_OnBillingHold_OrWithTheProgramOff()
    {
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(4), StorePurchaseState.Active, PaidEnd.AddYears(1)), []));
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(At(PaidEnd.AddMonths(4), StorePurchaseState.OnHold), []));
        var off = DataRetentionPolicy.Evaluate(new DataRetentionInput(false, Effective, Effective, PaidEnd, []), PaidEnd.AddYears(1));
        Assert.Equal(DataRetentionNotice.None, DataRetentionNotices.ToSend(off, []));
    }

    [Fact]
    public void TheDedupKey_IsStablePerAccountPeriodAndNotice_AndFitsTheColumn()
    {
        var key = DataRetentionNotices.DedupKey(long.MaxValue, PaidEnd, DataRetentionNotice.FinalNotice);
        Assert.Equal(key, DataRetentionNotices.DedupKey(long.MaxValue, PaidEnd.ToOffset(TimeSpan.FromHours(9)), DataRetentionNotice.FinalNotice));
        Assert.NotEqual(key, DataRetentionNotices.DedupKey(long.MaxValue, PaidEnd.AddMonths(1), DataRetentionNotice.FinalNotice));
        Assert.NotEqual(key, DataRetentionNotices.DedupKey(long.MaxValue, PaidEnd, DataRetentionNotice.DeletionScheduled));
        Assert.True(key.Length <= 120);
        Assert.StartsWith("retention:", key, StringComparison.Ordinal);
        Assert.Throws<ArgumentOutOfRangeException>(() => DataRetentionNotices.DedupKey(1, PaidEnd, DataRetentionNotice.None));
    }

    [Fact]
    public void Deletion_NeverProceeds_WithoutTheFinalNoticeOfThisPeriod_SentAWeekEarlier()
    {
        var due = At(PaidEnd.AddMonths(6));
        var finalSent = PaidEnd.AddMonths(6).AddDays(-7);

        Assert.True(DataRetentionNotices.DeletionMayProceed(due, finalSent, PaidEnd.AddMonths(6)));
        Assert.False(DataRetentionNotices.DeletionMayProceed(due, null, PaidEnd.AddMonths(7)));
        // Sent late: the deletion waits until the full week has passed since the notice.
        Assert.False(DataRetentionNotices.DeletionMayProceed(due, PaidEnd.AddMonths(6).AddDays(-1), PaidEnd.AddMonths(6)));
        Assert.True(DataRetentionNotices.DeletionMayProceed(due, PaidEnd.AddMonths(6).AddDays(-1), PaidEnd.AddMonths(6).AddDays(6)));
        // A notice from an EARLIER period (before this clock started) does not count.
        Assert.False(DataRetentionNotices.DeletionMayProceed(due, PaidEnd.AddDays(-1), PaidEnd.AddMonths(7)));
        // Not due yet, or re-subscribed: never.
        Assert.False(DataRetentionNotices.DeletionMayProceed(At(PaidEnd.AddMonths(5)), finalSent, PaidEnd.AddMonths(5)));
        Assert.False(DataRetentionNotices.DeletionMayProceed(At(PaidEnd.AddMonths(7), StorePurchaseState.Active, PaidEnd.AddYears(1)), finalSent, PaidEnd.AddMonths(7)));
    }
}
