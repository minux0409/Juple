using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

/// <summary>The post-subscription data retention policy (pure): who is scheduled, from when, and which notice is due.</summary>
public sealed class DataRetentionPolicyTests
{
    private static readonly DateTimeOffset PolicyEffective = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset PaidEnd = new(2027, 1, 15, 9, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset ExistingAccount = PolicyEffective.AddYears(-1);

    private static PurchaseAccess Purchase(StorePurchaseState state, DateTimeOffset? end, EntitlementReason reason = EntitlementReason.None) => new(state, reason, end);

    private static DataRetentionState Eval(DateTimeOffset now, params PurchaseAccess[] purchases) =>
        DataRetentionPolicy.Evaluate(new DataRetentionInput(true, PolicyEffective, ExistingAccount, ExistingAccount.AddDays(30), purchases), now);

    private static DataRetentionState TrialOnly(DateTimeOffset createdAt, DateTimeOffset? trialEnd, DateTimeOffset now, bool programEnabled = true, DateTimeOffset? effective = null) =>
        DataRetentionPolicy.Evaluate(new DataRetentionInput(programEnabled, effective ?? PolicyEffective, createdAt, trialEnd, []), now);

    [Fact]
    public void ProgramOff_NobodyIsEverScheduled_NeitherByPurchasesNorBySignUpOrTrialEnd()
    {
        var paid = DataRetentionPolicy.Evaluate(new DataRetentionInput(false, PolicyEffective, ExistingAccount, null, [Purchase(StorePurchaseState.Expired, PaidEnd)]), PaidEnd.AddYears(3));
        Assert.Equal((DataRetentionPhase.NotApplicable, DataRetentionNotApplicableReason.ProgramNotRunning), (paid.Phase, paid.NotApplicableReason));
        Assert.Null(paid.DeletionDueAtUtc);
        Assert.Equal(DataRetentionNotice.None, paid.DueNotice);

        // Production today: Billing off. A new account whose trial window ended long ago is still never a target.
        var created = PolicyEffective.AddDays(1);
        var trial = TrialOnly(created, created.AddDays(30), created.AddYears(2), programEnabled: false);
        Assert.Equal((DataRetentionPhase.NotApplicable, DataRetentionNotApplicableReason.ProgramNotRunning), (trial.Phase, trial.NotApplicableReason));
        Assert.Null(trial.DeletionDueAtUtc);
    }

    [Fact]
    public void WithoutAnEffectiveInstant_ThePolicyIsNotInEffect_EvenWithTheProgramOn()
    {
        var state = DataRetentionPolicy.Evaluate(new DataRetentionInput(true, null, ExistingAccount, null, [Purchase(StorePurchaseState.Expired, PaidEnd)]), PaidEnd.AddYears(1));
        Assert.Equal((DataRetentionPhase.NotApplicable, DataRetentionNotApplicableReason.PolicyNotInEffect), (state.Phase, state.NotApplicableReason));
        Assert.Null(state.DeletionDueAtUtc);
    }

    [Theory]
    [InlineData(StorePurchaseState.Active)]
    [InlineData(StorePurchaseState.Canceled)]     // auto-renew off, but the paid period has not ended: still live
    [InlineData(StorePurchaseState.GracePeriod)]
    public void LiveAccess_IsActive(StorePurchaseState state)
    {
        Assert.Equal(DataRetentionPhase.Active, Eval(PaidEnd.AddDays(-1), Purchase(state, PaidEnd)).Phase);
    }

    [Fact]
    public void ARunningTrial_IsActive()
    {
        var created = PolicyEffective.AddDays(1);
        Assert.Equal(DataRetentionPhase.Active, TrialOnly(created, created.AddDays(30), created.AddDays(29)).Phase);
    }

    [Fact]
    public void ATrialOnlyAccountCreatedUnderThePolicy_IsScheduledFromItsTrialEnd()
    {
        var created = PolicyEffective;   // exactly at the effective instant counts as "under the policy"
        var trialEnd = created.AddDays(30);
        var state = TrialOnly(created, trialEnd, trialEnd.AddDays(1));
        Assert.Equal((DataRetentionPhase.ReadOnly, DataRetentionBasis.TrialEnded), (state.Phase, state.Basis));
        Assert.Equal(trialEnd, state.RetentionStartedAtUtc);
        Assert.Equal(trialEnd.AddMonths(6), state.DeletionDueAtUtc);
        Assert.Equal(DataRetentionPhase.DeletionDue, TrialOnly(created, trialEnd, trialEnd.AddMonths(6)).Phase);
    }

    [Fact]
    public void ATrialOnlyAccountThatExistedBeforeThePolicy_IsNeverScheduledRetroactively()
    {
        var created = PolicyEffective.AddTicks(-1);
        var state = TrialOnly(created, created.AddDays(30), PolicyEffective.AddYears(2));
        Assert.Equal((DataRetentionPhase.NotApplicable, DataRetentionNotApplicableReason.TrialBeforePolicy), (state.Phase, state.NotApplicableReason));
        Assert.Null(state.DeletionDueAtUtc);
    }

    [Fact]
    public void NoEndedAccessToCountFrom_IsNotScheduled()
    {
        var created = PolicyEffective.AddDays(1);
        Assert.Equal(DataRetentionNotApplicableReason.NoAccessHistory, TrialOnly(created, null, created.AddYears(1)).NotApplicableReason);
        var pendingOnly = DataRetentionPolicy.Evaluate(new DataRetentionInput(true, PolicyEffective, created, null, [Purchase(StorePurchaseState.Pending, null)]), created.AddYears(1));
        Assert.Equal(DataRetentionNotApplicableReason.NoAccessHistory, pendingOnly.NotApplicableReason);
        // A cancelled pending purchase (no access period) is not paid history either.
        var cancelledPending = DataRetentionPolicy.Evaluate(new DataRetentionInput(true, PolicyEffective, created, null, [Purchase(StorePurchaseState.Expired, null)]), created.AddYears(1));
        Assert.Equal(DataRetentionNotApplicableReason.NoAccessHistory, cancelledPending.NotApplicableReason);
    }

    [Fact]
    public void APaidEndBeforeThePolicy_CountsFromTheEffectiveInstant()
    {
        var oldEnd = PolicyEffective.AddMonths(-4);
        var state = Eval(PolicyEffective.AddDays(1), Purchase(StorePurchaseState.Expired, oldEnd));
        Assert.Equal((DataRetentionPhase.ReadOnly, DataRetentionBasis.PaidAccessEnded), (state.Phase, state.Basis));
        Assert.Equal(PolicyEffective, state.RetentionStartedAtUtc);
        Assert.Equal(PolicyEffective.AddMonths(6), state.DeletionDueAtUtc);
    }

    [Fact]
    public void PaidAccess_WinsOverTheTrialBasis_ForAnExistingAccountToo()
    {
        var state = Eval(PaidEnd.AddDays(1), Purchase(StorePurchaseState.Expired, PaidEnd));
        Assert.Equal((DataRetentionBasis.PaidAccessEnded, (DateTimeOffset?)PaidEnd), (state.Basis, state.RetentionStartedAtUtc));
    }

    [Theory]
    [InlineData(StorePurchaseState.OnHold)]
    [InlineData(StorePurchaseState.Paused)]
    public void APaymentBeingRetried_OrAPause_HoldsTheClock(StorePurchaseState state)
    {
        var held = Eval(PaidEnd.AddMonths(7), Purchase(state, PaidEnd));
        Assert.Equal(DataRetentionPhase.BillingHold, held.Phase);
        Assert.Null(held.DeletionDueAtUtc);
    }

    [Fact]
    public void ThePaidEnd_StartsTheClock_NoticesAt3And5MonthsAndAWeekBefore_DeletionDueAt6Months()
    {
        var expired = Purchase(StorePurchaseState.Expired, PaidEnd, EntitlementReason.Cancelled);
        var day1 = Eval(PaidEnd.AddDays(1), expired);
        Assert.Equal(DataRetentionPhase.ReadOnly, day1.Phase);
        Assert.Equal(PaidEnd, day1.RetentionStartedAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 4, 15, 9, 0, 0, TimeSpan.Zero), day1.RetentionEndingNoticeAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 6, 15, 9, 0, 0, TimeSpan.Zero), day1.DeletionScheduledNoticeAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 7, 8, 9, 0, 0, TimeSpan.Zero), day1.FinalNoticeAtUtc);
        Assert.Equal(new DateTimeOffset(2027, 7, 15, 9, 0, 0, TimeSpan.Zero), day1.DeletionDueAtUtc);
        Assert.Equal(DataRetentionNotice.None, day1.DueNotice);

        // Exact boundaries: a notice is due AT its instant, not a tick before.
        var ending = day1.RetentionEndingNoticeAtUtc!.Value;
        Assert.Equal(DataRetentionNotice.None, Eval(ending.AddTicks(-1), expired).DueNotice);
        Assert.Equal(DataRetentionNotice.RetentionEnding, Eval(ending, expired).DueNotice);
        Assert.Equal(DataRetentionNotice.DeletionScheduled, Eval(day1.DeletionScheduledNoticeAtUtc!.Value, expired).DueNotice);
        Assert.Equal(DataRetentionNotice.FinalNotice, Eval(day1.FinalNoticeAtUtc!.Value, expired).DueNotice);
        var deletion = day1.DeletionDueAtUtc!.Value;
        Assert.Equal(DataRetentionPhase.ReadOnly, Eval(deletion.AddTicks(-1), expired).Phase);
        Assert.Equal(DataRetentionPhase.DeletionDue, Eval(deletion, expired).Phase);
    }

    [Fact]
    public void ResubscribingRestoresEverything_AndALaterExpiryStartsANewLaterClock()
    {
        var first = Purchase(StorePurchaseState.Expired, PaidEnd);
        var renewed = Purchase(StorePurchaseState.Active, PaidEnd.AddMonths(5).AddDays(30));
        // Re-subscribed in month 5 (after the "deletion scheduled" notice): live again, nothing scheduled.
        Assert.Equal(DataRetentionPhase.Active, Eval(PaidEnd.AddMonths(5).AddDays(1), first, renewed).Phase);

        // The new subscription ends later: the clock restarts from that end, not the first one.
        var renewedEnded = Purchase(StorePurchaseState.Expired, PaidEnd.AddMonths(5).AddDays(30));
        var later = Eval(PaidEnd.AddMonths(7), first, renewedEnded);
        Assert.Equal(PaidEnd.AddMonths(5).AddDays(30), later.RetentionStartedAtUtc);
        Assert.Equal(DataRetentionPhase.ReadOnly, later.Phase);

        // A trial-only account that subscribes after its trial: the paid end replaces the trial basis.
        var created = PolicyEffective.AddDays(1);
        var paidAfterTrial = DataRetentionPolicy.Evaluate(
            new DataRetentionInput(true, PolicyEffective, created, created.AddDays(30), [Purchase(StorePurchaseState.Expired, created.AddMonths(4))]),
            created.AddMonths(5));
        Assert.Equal((DataRetentionBasis.PaidAccessEnded, (DateTimeOffset?)created.AddMonths(4)), (paidAfterTrial.Basis, paidAfterTrial.RetentionStartedAtUtc));
    }

    [Fact]
    public void ARefund_EndsAccessWhenRevoked_AndTheClockStartsThere()
    {
        var revokedAt = PaidEnd.AddDays(-10);
        var state = Eval(PaidEnd, Purchase(StorePurchaseState.Revoked, revokedAt, EntitlementReason.Refunded));
        Assert.Equal((DataRetentionPhase.ReadOnly, (DateTimeOffset?)revokedAt), (state.Phase, state.RetentionStartedAtUtc));
    }

    [Fact]
    public void TheSameInputs_AlwaysGiveTheSameAnswer_InAnyTimeZone()
    {
        var seoul = TimeSpan.FromHours(9);
        var a = Eval(PaidEnd.AddMonths(4), Purchase(StorePurchaseState.Expired, PaidEnd));
        var b = DataRetentionPolicy.Evaluate(
            new DataRetentionInput(true, PolicyEffective.ToOffset(seoul), ExistingAccount.ToOffset(seoul), ExistingAccount.AddDays(30).ToOffset(seoul), [Purchase(StorePurchaseState.Expired, PaidEnd.ToOffset(seoul))]),
            PaidEnd.AddMonths(4).ToOffset(seoul));
        Assert.Equal(a, b);
        Assert.Equal(a, Eval(PaidEnd.AddMonths(4), Purchase(StorePurchaseState.Expired, PaidEnd)));
    }
}
