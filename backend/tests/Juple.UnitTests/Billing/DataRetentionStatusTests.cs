using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

/// <summary>The retention status the bootstrap carries: read from the entitlement's own facts, and absent whenever nothing is scheduled.</summary>
public sealed class DataRetentionStatusTests
{
    private static readonly DateTimeOffset Now = new(2027, 9, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Effective = new(2026, 12, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset PaidEnd = new(2027, 6, 1, 0, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ProgramOff_IsNotApplicable_AndReadsNothing()
    {
        var store = new ThrowingStore();
        var options = new BillingOptions { ProgramEnabled = false, DataRetention = { PolicyEffectiveAtUtc = Effective } };

        var state = await new DataRetentionService(options, store, new FixedTime(Now)).GetForUserAsync(1);

        Assert.Equal((DataRetentionPhase.NotApplicable, DataRetentionNotApplicableReason.ProgramNotRunning), (state.Phase, state.NotApplicableReason));
        Assert.Null(DataRetentionResponse(state));
    }

    [Fact]
    public async Task NoEffectiveInstant_IsNotApplicable_AndReadsNothing_EvenWithTheProgramOn()
    {
        var options = new BillingOptions { ProgramEnabled = true };

        var state = await new DataRetentionService(options, new ThrowingStore(), new FixedTime(Now)).GetForUserAsync(1);

        Assert.Equal(DataRetentionNotApplicableReason.PolicyNotInEffect, state.NotApplicableReason);
        Assert.Null(new BillingOptions().DataRetention.PolicyEffectiveAtUtc);
    }

    [Fact]
    public async Task InEffect_UsesTheAccountsCreationTrialAndPurchases()
    {
        var store = new Store(
            new EntitlementUserState(1, Effective.AddDays(1), Effective.AddDays(1), Effective.AddDays(31), null),
            [new PurchaseAccess(StorePurchaseState.Expired, EntitlementReason.Cancelled, PaidEnd)]);
        var options = new BillingOptions { ProgramEnabled = true, DataRetention = { PolicyEffectiveAtUtc = Effective } };

        var state = await new DataRetentionService(options, store, new FixedTime(Now)).GetForUserAsync(1);

        Assert.Equal((DataRetentionPhase.ReadOnly, DataRetentionBasis.PaidAccessEnded, (DateTimeOffset?)PaidEnd), (state.Phase, state.Basis, state.RetentionStartedAtUtc));
        var response = DataRetentionResponse(state)!;
        Assert.Equal(("readOnly", "paidAccessEnded", true), (response.Phase, response.Basis, response.ReadOnly));
        Assert.Equal(PaidEnd, response.AccessEndedAtUtc);
        Assert.Equal(PaidEnd.AddMonths(6), response.DeletionScheduledAtUtc);
        // 2027-09-01 is exactly the 3-month notice instant, so the next one is the 5-month notice.
        Assert.Equal(PaidEnd.AddMonths(5), response.NextNoticeAtUtc);
    }

    [Fact]
    public void TheBlock_IsOmittedWhileAccessIsLive_AndCarriesNoDatesWhileBillingIsOnHold()
    {
        var input = new DataRetentionInput(true, Effective, Effective.AddDays(-10), null, [new PurchaseAccess(StorePurchaseState.Active, EntitlementReason.None, Now.AddDays(10))]);
        Assert.Null(DataRetentionResponse(DataRetentionPolicy.Evaluate(input, Now)));

        var hold = DataRetentionPolicy.Evaluate(input with { Purchases = [new PurchaseAccess(StorePurchaseState.OnHold, EntitlementReason.BillingIssue, PaidEnd)] }, Now);
        var response = DataRetentionResponse(hold)!;
        Assert.Equal(("billingHold", true), (response.Phase, response.ReadOnly));
        Assert.Null(response.DeletionScheduledAtUtc);
        Assert.Null(response.NextNoticeAtUtc);
    }

    [Fact]
    public void AfterTheDeletionDate_ThePhaseIsDeletionDue_WithNoNoticeLeft()
    {
        var state = DataRetentionPolicy.Evaluate(
            new DataRetentionInput(true, Effective, Effective.AddDays(-10), null, [new PurchaseAccess(StorePurchaseState.Expired, EntitlementReason.None, PaidEnd)]),
            PaidEnd.AddMonths(7));
        var response = DataRetentionResponse(state, PaidEnd.AddMonths(7))!;
        Assert.Equal("deletionDue", response.Phase);
        Assert.Null(response.NextNoticeAtUtc);
        Assert.Null(DataRetentionPolicy.NextNoticeAtUtc(state, PaidEnd.AddMonths(7)));
        Assert.Equal(PaidEnd.AddMonths(3), DataRetentionPolicy.NextNoticeAtUtc(state, PaidEnd));
        Assert.Equal(PaidEnd.AddMonths(6).AddDays(-7), DataRetentionPolicy.NextNoticeAtUtc(state, PaidEnd.AddMonths(5)));
    }

    private static CurrentUserBootstrapController.DataRetentionResponse? DataRetentionResponse(DataRetentionState state, DateTimeOffset? nowUtc = null) =>
        CurrentUserBootstrapController.DataRetentionResponse.From(state, nowUtc ?? Now);

    private sealed class FixedTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private class Store(EntitlementUserState? state, IReadOnlyList<PurchaseAccess> purchases) : IEntitlementStore
    {
        public virtual Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default) => Task.FromResult(state);

        public Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("not used");

        public virtual Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) => Task.FromResult(purchases);

        public Task<IReadOnlyList<OwnedStorePurchase>> GetOwnedPurchasesAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("not used");

        public Task<TrialWindow> EnsureTrialAsync(long userId, byte[] identityHash, TrialWindow newWindow, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("retention never settles a trial");
    }

    private sealed class ThrowingStore() : Store(null, [])
    {
        public override Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("nothing may be read while the policy cannot apply");

        public override Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new InvalidOperationException("nothing may be read while the policy cannot apply");
    }
}
