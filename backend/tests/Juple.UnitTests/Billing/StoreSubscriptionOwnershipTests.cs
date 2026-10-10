using System.Text.Json;
using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing;

/// <summary>
/// STORE SUBSCRIPTION OWNERSHIP is its own fact, separate from the entitlement (access): with the program off the entitlement is NotLaunched
/// - nothing is required - while an account that really pays for a subscription must still be known as subscribed.
/// </summary>
public sealed class StoreSubscriptionOwnershipTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 10, 12, 0, 0, TimeSpan.Zero);

    private static OwnedStorePurchase Purchase(StorePurchaseState state, TimeSpan? endsIn, bool? autoRenews = true, string productId = "juple_monthly") =>
        new(StoreSource.GooglePlay, productId, state, endsIn is { } span ? Now + span : null, autoRenews);

    private sealed class Store(params OwnedStorePurchase[] owned) : IEntitlementStore
    {
        public int OwnedReads { get; private set; }

        public Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<EntitlementUserState?>(new EntitlementUserState(userId, Now.AddDays(-90), null, null, null));

        public Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            GetUserStateAsync(7, cancellationToken);

        public Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Ownership must not touch the access calculation.");

        public Task<IReadOnlyList<OwnedStorePurchase>> GetOwnedPurchasesAsync(long userId, CancellationToken cancellationToken = default)
        {
            OwnedReads++;
            return Task.FromResult<IReadOnlyList<OwnedStorePurchase>>(owned);
        }

        public Task<TrialWindow> EnsureTrialAsync(long userId, byte[] identityHash, TrialWindow newWindow, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Reading ownership must never start or consume a trial.");
    }

    private sealed class StubTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private static EntitlementService Service(BillingOptions options, params OwnedStorePurchase[] owned) =>
        new(options, new Store(owned), new TrialIdentityHasher(options), new StubTime(Now));

    private static readonly ExternalIdentityPrincipal Identity = new(Guid.NewGuid(), Guid.NewGuid());

    // ---------- the program is OFF: access says "not required", ownership still tells the truth ----------

    [Fact]
    public async Task ProgramOff_NoPurchase_AccessIsNotLaunched_AndThereIsNoSubscription()
    {
        var service = Service(new BillingOptions());

        var entitlement = await service.GetForIdentityAsync(Identity);
        var ownership = await service.GetStoreSubscriptionForIdentityAsync(Identity);

        Assert.False(entitlement.ProgramEnabled);
        Assert.Null(entitlement.Status);
        Assert.Equal(StoreSubscriptionState.None, ownership.State);
        Assert.Null(ownership.ProductId);
    }

    [Fact]
    public async Task ProgramOff_AnActiveGoogleSubscription_StillMeansNothingIsRequired_YetTheAccountIsSubscribed()
    {
        var service = Service(new BillingOptions(), Purchase(StorePurchaseState.Active, TimeSpan.FromMinutes(5)));

        var entitlement = await service.GetForIdentityAsync(Identity);
        var ownership = await service.GetStoreSubscriptionForIdentityAsync(Identity);

        // Access: unchanged - not launched, nothing restricted, nothing claimed.
        Assert.False(entitlement.ProgramEnabled);
        Assert.Null(entitlement.Status);
        Assert.True(entitlement.CanWrite);
        // Ownership: subscribed, with what the screen needs.
        Assert.Equal(StoreSubscriptionState.Active, ownership.State);
        Assert.Equal(StoreSource.GooglePlay, ownership.Source);
        Assert.Equal("juple_monthly", ownership.ProductId);
        Assert.Equal(Now.AddMinutes(5), ownership.CurrentPeriodEndsAtUtc);
        Assert.True(ownership.AutoRenewing);
    }

    [Fact]
    public async Task ProgramOff_AGracePeriodSubscription_IsOwnedAsGracePeriod()
    {
        var service = Service(new BillingOptions(), Purchase(StorePurchaseState.GracePeriod, TimeSpan.FromDays(2)));

        Assert.Equal(StoreSubscriptionState.GracePeriod, (await service.GetStoreSubscriptionForIdentityAsync(Identity)).State);
        Assert.Null((await service.GetForIdentityAsync(Identity)).Status);
    }

    [Fact]
    public async Task ProgramOff_ACancelledButCurrentSubscription_IsStillOwned_ItJustWillNotRenew()
    {
        var service = Service(new BillingOptions(), Purchase(StorePurchaseState.Canceled, TimeSpan.FromDays(9), autoRenews: true));

        var ownership = await service.GetStoreSubscriptionForIdentityAsync(Identity);

        Assert.Equal(StoreSubscriptionState.Active, ownership.State);
        Assert.False(ownership.AutoRenewing);
    }

    [Theory]
    [InlineData(StorePurchaseState.Expired)]
    [InlineData(StorePurchaseState.Pending)]
    [InlineData(StorePurchaseState.OnHold)]
    [InlineData(StorePurchaseState.Revoked)]
    public async Task ProgramOff_AnEndedOrNotYetPaidSubscription_IsNotOwned(StorePurchaseState state)
    {
        var service = Service(new BillingOptions(), Purchase(state, TimeSpan.FromDays(1)));

        Assert.Equal(StoreSubscriptionState.None, (await service.GetStoreSubscriptionForIdentityAsync(Identity)).State);
    }

    [Fact]
    public async Task ASubscriptionWhoseEndAlreadyPassed_IsNotOwned_EvenIfItsRowStillSaysActive_UntilTheStoreRenewsIt()
    {
        var service = Service(new BillingOptions(), Purchase(StorePurchaseState.Active, TimeSpan.FromSeconds(-1)));

        Assert.Equal(StoreSubscriptionState.None, (await service.GetStoreSubscriptionForIdentityAsync(Identity)).State);
    }

    [Fact]
    public void FullyPaidBeatsGrace_AndTheLongestWinsAmongEquals()
    {
        var owned = new[]
        {
            Purchase(StorePurchaseState.GracePeriod, TimeSpan.FromDays(30)),
            Purchase(StorePurchaseState.Active, TimeSpan.FromDays(2)),
            Purchase(StorePurchaseState.Active, TimeSpan.FromDays(9)),
        };

        var ownership = StoreSubscriptionOwnership.From(owned, Now);

        Assert.Equal(StoreSubscriptionState.Active, ownership.State);
        Assert.Equal(Now.AddDays(9), ownership.CurrentPeriodEndsAtUtc);
    }

    [Fact]
    public async Task ReadingOwnership_NeverStartsATrial_NorTouchesTheAccessCalculation()
    {
        // The fake store throws if the trial is settled or the access purchases are read.
        var service = Service(new BillingOptions(), Purchase(StorePurchaseState.Active, TimeSpan.FromDays(1)));

        await service.GetStoreSubscriptionForIdentityAsync(Identity);
    }

    [Fact]
    public async Task ProgramOn_AccessAndOwnershipAgree_ButStayTwoSeparateAnswers()
    {
        var options = new BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = DateTimeOffset.UnixEpoch, TrialIdentityHashKey = GooglePlay.GoogleTestData.Key32 };
        var service = Service(options, Purchase(StorePurchaseState.Active, TimeSpan.FromDays(3)));

        Assert.Equal(StoreSubscriptionState.Active, (await service.GetStoreSubscriptionForIdentityAsync(Identity)).State);
    }

    // ---------- the wire contract: nothing sensitive ----------

    [Fact]
    public void TheResponse_CarriesOnlyStateStoreProductPeriodAndRenewal_NoTokenNoIdNoOrder()
    {
        var response = CurrentUserBootstrapController.StoreSubscriptionResponse.From(
            StoreSubscriptionOwnership.From([Purchase(StorePurchaseState.Active, TimeSpan.FromDays(3))], Now));

        var json = JsonSerializer.Serialize(response, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var keys = JsonDocument.Parse(json).RootElement.EnumerateObject().Select(property => property.Name).Order().ToList();

        Assert.Equal(["autoRenewing", "currentPeriodEndsAtUtc", "platform", "productId", "state"], keys);
        Assert.Contains("\"platform\":\"google\"", json);
        Assert.Contains("\"state\":\"active\"", json);
        foreach (var forbidden in new[] { "token", "order", "userId", "purchaseId", "hash", "handle", "credential" })
        {
            Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public void NoSubscription_IsAnExplicitNone_NotAMissingObject()
    {
        var response = CurrentUserBootstrapController.StoreSubscriptionResponse.From(null);

        Assert.Equal(new CurrentUserBootstrapController.StoreSubscriptionResponse("none", null, null, null, null), response);
        Assert.Equal("none", CurrentUserBootstrapController.StoreSubscriptionResponse.From(StoreSubscriptionOwnership.None).State);
    }

    [Fact]
    public void GracePeriodAndActive_AreTheOnlyOwnedWireStates()
    {
        Assert.Equal("gracePeriod", CurrentUserBootstrapController.StoreSubscriptionResponse.From(
            StoreSubscriptionOwnership.From([Purchase(StorePurchaseState.GracePeriod, TimeSpan.FromDays(1))], Now)).State);
        Assert.Equal("active", CurrentUserBootstrapController.StoreSubscriptionResponse.From(
            StoreSubscriptionOwnership.From([Purchase(StorePurchaseState.Canceled, TimeSpan.FromDays(1), autoRenews: false)], Now)).State);
    }
}
