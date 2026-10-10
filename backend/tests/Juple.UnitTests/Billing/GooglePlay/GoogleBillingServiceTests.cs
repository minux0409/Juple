using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing.GooglePlay;

public sealed class GoogleBillingServiceTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private const long UserA = 101;
    private const long UserB = 202;
    private const string Token = "token-A-0123456789";

    private sealed class Harness
    {
        public BillingOptions Options { get; } = GoogleTestData.Options();
        public FakeGooglePlayClient Google { get; } = new();
        public FakeGoogleBillingStore Store { get; } = new();
        public FakeTelemetry Telemetry { get; } = new();
        public StubTime Time { get; } = new(Now);
        public IPurchaseTokenProtector Tokens { get; }
        public GoogleAccountIdProvider Accounts { get; }
        public GoogleBillingService Service { get; }

        public Harness()
        {
            Tokens = new PurchaseTokenProtector(Options);
            Accounts = new GoogleAccountIdProvider(Options);
            Service = new GoogleBillingService(Options, Google, Store, Accounts, Tokens, Telemetry, Time);
        }

        public string KeyOf(long userId) => Accounts.Compute(userId);

        public GoogleSubscriptionSnapshot ActiveFor(long userId, bool ackPending = true) =>
            GoogleTestData.Snapshot(GoogleSubscriptionState.Active, KeyOf(userId), Now.AddDays(30), ackPending);
    }

    [Fact]
    public async Task Catalog_Disabled_RevealsNothing()
    {
        var harness = new Harness();
        harness.Options.Google.Enabled = false;

        var catalog = await harness.Service.GetCatalogAsync(UserA);

        Assert.Equal(new GoogleCatalog(false, null, null, null), catalog);
    }

    [Fact]
    public async Task Catalog_Enabled_ReturnsTheAllowlistAndTheOpaqueAccountId_NeverTheUserIdOrAPrice()
    {
        var harness = new Harness();

        var catalog = await harness.Service.GetCatalogAsync(UserA);

        Assert.True(catalog.Enabled);
        Assert.Equal(GoogleTestData.ProductId, catalog.ProductId);
        Assert.Equal(GoogleTestData.BasePlanId, catalog.BasePlanId);
        Assert.Equal(harness.KeyOf(UserA), catalog.ObfuscatedAccountId);
        Assert.DoesNotContain(UserA.ToString(), catalog.ObfuscatedAccountId!, StringComparison.Ordinal);
        // The account link is recorded so a notification can resolve the id back to the account.
        Assert.Equal(UserA, await harness.Store.FindUserIdByAccountKeyAsync(catalog.ObfuscatedAccountId!));
    }

    [Fact]
    public async Task VerifyActive_LinksTheAccount_AcknowledgesExactlyOnce_AndNormalizesTheResult()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA));

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(new GoogleVerifyResult(GoogleVerifyOutcome.Verified, StorePurchaseState.Active, Acknowledged: true), result);
        Assert.Equal([Token], harness.Google.Acknowledged);
        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(UserA, purchase.UserId);
        Assert.Equal(StorePurchaseState.Active, purchase.State);
        Assert.False(purchase.AcknowledgementPending);
        Assert.NotNull(purchase.AcknowledgedAtUtc);
        // Only the sealed token is kept.
        Assert.Equal(Token, harness.Tokens.Open(purchase.VerificationHandleEncrypted));
    }

    [Fact]
    public async Task VerifyAgain_BySameUser_ConvergesWithoutASecondRowOrASecondAcknowledgement()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA));

        await harness.Service.VerifyAsync(UserA, Token);
        var again = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.Verified, again.Outcome);
        Assert.Single(harness.Store.Purchases);
        Assert.Single(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task VerifyPending_GrantsNothing_AndIsNeverAcknowledged()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Pending, harness.KeyOf(UserA), expiry: null));

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.Pending, result.Outcome);
        Assert.Empty(harness.Google.Acknowledged);
        Assert.False(new PurchaseAccess(StorePurchaseState.Pending, EntitlementReason.None, null).IsLiveAt(Now));
    }

    [Theory]
    [InlineData(GoogleSubscriptionState.OnHold)]
    [InlineData(GoogleSubscriptionState.Paused)]
    [InlineData(GoogleSubscriptionState.Expired)]
    public async Task VerifyALapsedPurchase_IsLinkedButGrantsNoAccess_AndIsNotAcknowledged(GoogleSubscriptionState state)
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(state, harness.KeyOf(UserA), Now.AddDays(-2)));

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.NotEntitled, result.Outcome);
        Assert.Empty(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task VerifyCanceledButPaid_StaysVerified()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Canceled, harness.KeyOf(UserA), Now.AddDays(9), ackPending: false));

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(new GoogleVerifyResult(GoogleVerifyOutcome.Verified, StorePurchaseState.Canceled, Acknowledged: true), result);
    }

    [Fact]
    public async Task ATokenLinkedToAnotherAccount_IsRefused_BeforeGoogleIsEvenAsked_AndNeverTransferred()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA));
        await harness.Service.VerifyAsync(UserA, Token);
        var callsBefore = harness.Google.GetCalls;

        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => harness.Service.VerifyAsync(UserB, Token));

        Assert.Equal(callsBefore, harness.Google.GetCalls);
        Assert.Equal(UserA, Assert.Single(harness.Store.Purchases.Values).UserId);
        Assert.Contains("conflict:verify", harness.Telemetry.Entries);
    }

    [Fact]
    public async Task APurchaseWhoseAccountIdIsAnotherLiveAccounts_IsAConflict_NotAForgery()
    {
        var harness = new Harness();
        // User A is a live account with its link; user B presents a token that Google says was bought as A.
        await harness.Service.GetCatalogAsync(UserA);
        harness.Google.Set("stolen", harness.ActiveFor(UserA));

        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => harness.Service.VerifyAsync(UserB, "stolen"));

        Assert.Empty(harness.Store.Purchases);
        Assert.Empty(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task AWrongOrMissingAccountId_IsRefused_AndNothingIsStoredOrAcknowledged()
    {
        var harness = new Harness();
        harness.Google.Set("unknown-account", GoogleTestData.Snapshot(obfuscatedAccountId: "no-such-account-key", expiry: Now.AddDays(30)));
        harness.Google.Set("no-account", GoogleTestData.Snapshot(obfuscatedAccountId: null, expiry: Now.AddDays(30)));

        var wrong = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, "unknown-account"));
        var missing = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, "no-account"));

        Assert.Equal(PurchaseRejectionReason.Account, wrong.Reason);
        Assert.Equal(PurchaseRejectionReason.Account, missing.Reason);
        Assert.Empty(harness.Store.Purchases);
        Assert.Empty(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task AProductOrBasePlanThatIsNotAllowlisted_IsRefused_NeverAcknowledged()
    {
        var harness = new Harness();
        harness.Google.Set("wrong-product", GoogleTestData.Snapshot(obfuscatedAccountId: harness.KeyOf(UserA), expiry: Now.AddDays(30), productId: "other_product"));
        harness.Google.Set("wrong-plan", GoogleTestData.Snapshot(obfuscatedAccountId: harness.KeyOf(UserA), expiry: Now.AddDays(30), basePlanId: "yearly"));

        var product = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, "wrong-product"));
        var plan = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, "wrong-plan"));

        Assert.Equal(PurchaseRejectionReason.Product, product.Reason);
        Assert.Equal(PurchaseRejectionReason.Product, plan.Reason);
        Assert.Empty(harness.Store.Purchases);
        Assert.Empty(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task APrepaidPlan_IsRefused()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(obfuscatedAccountId: harness.KeyOf(UserA), expiry: Now.AddDays(30), plan: GooglePlanType.Prepaid));

        var rejection = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, Token));

        Assert.Equal(PurchaseRejectionReason.PlanType, rejection.Reason);
    }

    [Fact]
    public async Task ForgedOrUnknownTokens_AreNotFound_AndEmptyOnesToo()
    {
        var harness = new Harness();

        await Assert.ThrowsAsync<GooglePlayPurchaseNotFoundException>(() => harness.Service.VerifyAsync(UserA, "forged"));
        await Assert.ThrowsAsync<GooglePlayPurchaseNotFoundException>(() => harness.Service.VerifyAsync(UserA, "   "));
        await Assert.ThrowsAsync<GooglePlayPurchaseNotFoundException>(() => harness.Service.VerifyAsync(UserA, new string('x', 5000)));
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task GoogleTimeoutOrMalformedResponse_IsTypedAndStoresNothing()
    {
        var harness = new Harness();
        harness.Google.Fail("slow", new GooglePlayUnavailableException("timeout"));
        harness.Google.Fail("garbage", new GooglePlayMalformedResponseException("partial line items"));

        await Assert.ThrowsAsync<GooglePlayUnavailableException>(() => harness.Service.VerifyAsync(UserA, "slow"));
        await Assert.ThrowsAsync<GooglePlayMalformedResponseException>(() => harness.Service.VerifyAsync(UserA, "garbage"));

        Assert.Empty(harness.Store.Purchases);
        Assert.Contains(harness.Telemetry.Entries, entry => entry.StartsWith("googleFailed:subscriptionsv2.get", StringComparison.Ordinal));
    }

    [Fact]
    public async Task AnAcknowledgementFailure_DoesNotUndoTheVerification_TheRetryStaysFlagged()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA));
        harness.Google.AcknowledgeFailure = new GooglePlayUnavailableException("503");

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        Assert.False(result.Acknowledged);
        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.True(purchase.AcknowledgementPending);
        Assert.Contains("ackFailed", harness.Telemetry.Entries);
    }

    [Fact]
    public async Task IfTheDeviceAcknowledgedFirst_TheFailedServerAckIsStillSuccess()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA));
        harness.Google.AcknowledgeFailure = new GooglePlayPurchaseNotFoundException();
        harness.Google.AcknowledgeFailureButNowAcknowledged = true;

        var result = await harness.Service.VerifyAsync(UserA, Token);

        Assert.True(result.Acknowledged);
        Assert.False(Assert.Single(harness.Store.Purchases.Values).AcknowledgementPending);
    }

    [Fact]
    public async Task ADetachedPurchase_WhoseAccountWasDeleted_CanBeClaimedByAVerifiedRestore()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA, ackPending: false));
        await harness.Service.VerifyAsync(UserA, Token);
        // Account A is deleted: its link goes, its purchase is detached (UserId null).
        harness.Store.RemoveLinkOf(UserA);
        harness.Store.Purchases.Values.Single().GetType().GetProperty(nameof(StorePurchase.UserId))!.SetValue(harness.Store.Purchases.Values.Single(), null);

        var result = await harness.Service.VerifyAsync(UserB, Token);

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        Assert.Equal(UserB, Assert.Single(harness.Store.Purchases.Values).UserId);
    }

    [Fact]
    public async Task Restore_Outcomes()
    {
        var harness = new Harness();
        harness.Google.Set("good", harness.ActiveFor(UserA, ackPending: false));
        harness.Google.Set("others", harness.ActiveFor(UserB, ackPending: false));
        await harness.Service.GetCatalogAsync(UserB);
        harness.Google.Fail("down", new GooglePlayUnavailableException("503"));

        Assert.Equal(GoogleRestoreOutcome.Restored, (await harness.Service.RestoreAsync(UserA, ["good"])).Outcome);
        Assert.Equal(GoogleRestoreOutcome.BelongsToAnotherJupleAccount, (await harness.Service.RestoreAsync(UserA, ["others"])).Outcome);
        Assert.Equal(GoogleRestoreOutcome.TemporaryFailure, (await harness.Service.RestoreAsync(UserA, ["down"])).Outcome);
        Assert.Equal(GoogleRestoreOutcome.NothingFound, (await harness.Service.RestoreAsync(UserA, ["unknown-token"])).Outcome);
        Assert.Equal(GoogleRestoreOutcome.NothingFound, (await new Harness().Service.RestoreAsync(UserA, [])).Outcome);
    }

    [Fact]
    public async Task Restore_WithNoTokens_RefreshesTheAccountsOwnPurchasesFromGoogle()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA, ackPending: false));
        await harness.Service.VerifyAsync(UserA, Token);
        harness.Time.Now = Now.AddDays(1);

        var result = await harness.Service.RestoreAsync(UserA, []);

        Assert.Equal(GoogleRestoreOutcome.Restored, result.Outcome);
    }

    [Fact]
    public async Task APurchaseWhoseSealedTokenWasRemovedByRetention_IsSkippedByARestoreWithNoTokens_AndNeverCallsGoogle()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA, ackPending: false));
        await harness.Service.VerifyAsync(UserA, Token);
        var id = harness.Store.Purchases.Keys.Single();
        harness.Store.PurgeSealedToken(id);
        var callsBefore = harness.Google.GetCalls;

        var result = await harness.Service.RestoreAsync(UserA, []);

        Assert.Equal(GoogleRestoreOutcome.NothingFound, result.Outcome);
        Assert.Equal(callsBefore, harness.Google.GetCalls);
    }

    [Fact]
    public async Task AfterTheSealedTokenIsRemoved_PresentingTheTokenAgainStillMatchesTheSameRecord_NeverADuplicate()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA, ackPending: false));
        await harness.Service.VerifyAsync(UserA, Token);
        harness.Store.PurgeSealedToken(harness.Store.Purchases.Keys.Single());

        var again = await harness.Service.VerifyAsync(UserA, Token);

        Assert.Equal(GoogleVerifyOutcome.Verified, again.Outcome);
        Assert.Single(harness.Store.Purchases);
    }

    [Fact]
    public async Task AfterTheSealedTokenIsRemoved_AnotherAccountStillCannotTakeThePurchase_TheHashIsTheIdentity()
    {
        var harness = new Harness();
        harness.Google.Set(Token, harness.ActiveFor(UserA, ackPending: false));
        await harness.Service.VerifyAsync(UserA, Token);
        harness.Store.PurgeSealedToken(harness.Store.Purchases.Keys.Single());

        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => harness.Service.VerifyAsync(UserB, Token));
        Assert.Equal(UserA, Assert.Single(harness.Store.Purchases.Values).UserId);
    }

    [Fact]
    public async Task Restore_ASeverelyLongTokenList_IsBounded()
    {
        var harness = new Harness();
        var tokens = Enumerable.Range(0, 50).Select(index => $"t{index}").ToList();

        await harness.Service.RestoreAsync(UserA, tokens);

        Assert.Equal(10, harness.Google.GetCalls);
    }

    [Fact]
    public async Task VerifyAndRestore_AreRefusedWhileGoogleBillingIsDisabled()
    {
        var harness = new Harness();
        harness.Options.Google.Enabled = false;

        await Assert.ThrowsAsync<BillingNotEnabledException>(() => harness.Service.VerifyAsync(UserA, Token));
        await Assert.ThrowsAsync<BillingNotEnabledException>(() => harness.Service.RestoreAsync(UserA, [Token]));
    }
}
