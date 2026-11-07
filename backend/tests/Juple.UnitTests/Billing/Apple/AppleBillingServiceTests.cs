using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Juple.UnitTests.Billing.GooglePlay;

namespace Juple.UnitTests.Billing.Apple;

public sealed class AppleBillingServiceTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private const long UserA = 101;
    private const long UserB = 202;
    private const string OriginalId = "1000000000000001";

    private readonly AppleTestPki _pki = new(Now);

    public void Dispose() => _pki.Dispose();

    private sealed class Harness
    {
        public Harness(AppleTestPki pki, BillingOptions? options = null)
        {
            Options = options ?? AppleTestData.Options();
            Time = new StubTime(Now);
            Pki = pki;
            Tokens = new AppleAccountTokenProvider(Options);
            Handles = new ApplePurchaseHandleProtector(Options);
            Service = new AppleBillingService(Options, Apple, pki.Verifier(Time), Store, Tokens, Handles, Telemetry, Time);
        }

        public AppleTestPki Pki { get; }
        public BillingOptions Options { get; }
        public StubTime Time { get; }
        public FakeAppleStoreServerClient Apple { get; } = new();
        public FakeAppleBillingStore Store { get; } = new();
        public FakeTelemetry Telemetry { get; } = new();
        public AppleAccountTokenProvider Tokens { get; }
        public ApplePurchaseHandleProtector Handles { get; }
        public AppleBillingService Service { get; }

        public Guid TokenOf(long userId) => Tokens.Compute(userId);

        /// <summary>What the app would send: a transaction signed by Apple. Its content is irrelevant on purpose - only its identity is used.</summary>
        public string SignedBy(AppleTransaction transaction) => Pki.Sign(AppleTestData.TransactionPayload(transaction));

        public AppleTransaction ActiveFor(long userId, string originalId = OriginalId, string product = AppleTestData.Monthly, AppleEnvironment environment = AppleEnvironment.Production)
        {
            var transaction = AppleTestData.Transaction(originalId, product, TokenOf(userId), environment, Now.AddDays(30));
            Apple.Set(AppleTestData.Snapshot(transaction, renewal: new AppleRenewalInfo(originalId, product, true, null, null, null)));
            return transaction;
        }
    }

    [Fact]
    public async Task Catalog_Disabled_RevealsNothing()
    {
        var harness = new Harness(_pki, AppleTestData.Options(enabled: false));

        var catalog = await harness.Service.GetCatalogAsync(UserA);

        Assert.False(catalog.Enabled);
        Assert.Empty(catalog.ProductIds);
        Assert.Null(catalog.AppAccountToken);
    }

    [Fact]
    public async Task Catalog_Enabled_GivesBothProducts_AndAStableOpaqueTokenPerAccount()
    {
        var harness = new Harness(_pki);

        var first = await harness.Service.GetCatalogAsync(UserA);
        var again = await harness.Service.GetCatalogAsync(UserA);
        var other = await harness.Service.GetCatalogAsync(UserB);

        Assert.True(first.Enabled);
        Assert.Equal([AppleTestData.Monthly, AppleTestData.Yearly], first.ProductIds);
        Assert.Equal(first.AppAccountToken, again.AppAccountToken);
        Assert.NotEqual(first.AppAccountToken, other.AppAccountToken);
        Assert.NotEqual(Guid.Empty, first.AppAccountToken);
        // Opaque: not derivable from the user id without the key.
        Assert.DoesNotContain(UserA.ToString(), first.AppAccountToken!.Value.ToString("N"));
    }

    [Theory]
    [InlineData(AppleTestData.Monthly)]
    [InlineData(AppleTestData.Yearly)]
    public async Task Verify_BothProducts_GrantAccessFromTheStoresAnswer(string product)
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA, product: product);

        var result = await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        Assert.Equal(StorePurchaseState.Active, result.State);
        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(UserA, purchase.UserId);
        Assert.Equal(product, purchase.ProductId);
        Assert.Equal(Now.AddDays(30), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task Verify_NeverBelievesTheClient_TheStoreDecidesTheState()
    {
        var harness = new Harness(_pki);
        // The app presents a transaction that CLAIMS a year of access; the App Store says the subscription is expired.
        var claimed = AppleTestData.Transaction(OriginalId, token: harness.TokenOf(UserA), expires: Now.AddYears(1));
        var actual = AppleTestData.Transaction(OriginalId, token: harness.TokenOf(UserA), expires: Now.AddDays(-3));
        harness.Apple.Set(AppleTestData.Snapshot(actual, AppleSubscriptionStatus.Expired));

        var result = await harness.Service.VerifyAsync(UserA, harness.SignedBy(claimed));

        Assert.Equal(GoogleVerifyOutcome.NotEntitled, result.Outcome);
        Assert.Equal(StorePurchaseState.Expired, result.State);
        Assert.Equal(Now.AddDays(-3), harness.Store.Purchases.Values.Single().AccessEndsAtUtc);
    }

    [Fact]
    public async Task Verify_AsksTheEnvironmentTheTransactionBelongsTo()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA, environment: AppleEnvironment.Sandbox);

        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));

        Assert.Equal((OriginalId, AppleEnvironment.Sandbox), Assert.Single(harness.Apple.Requests));
    }

    [Fact]
    public async Task Verify_RefusesASandboxTransaction_WhenSandboxIsNotAccepted()
    {
        var harness = new Harness(_pki, AppleTestData.Options(acceptSandbox: false));
        var transaction = harness.ActiveFor(UserA, environment: AppleEnvironment.Sandbox);

        var exception = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction)));

        Assert.Equal(PurchaseRejectionReason.Product, exception.Reason);
        Assert.Equal(0, harness.Apple.Calls);
        Assert.Empty(harness.Store.Purchases);
    }

    [Theory]
    [InlineData("com.juple.app.something.else", AppleTestData.Bundle, "Auto-Renewable Subscription")]
    [InlineData(AppleTestData.Monthly, "com.someone.else", "Auto-Renewable Subscription")]
    [InlineData(AppleTestData.Monthly, AppleTestData.Bundle, "Consumable")]
    public async Task Verify_RefusesAnythingThatIsNotAJupleMembership(string product, string bundle, string type)
    {
        var harness = new Harness(_pki);
        var transaction = AppleTestData.Transaction(OriginalId, product, harness.TokenOf(UserA), expires: Now.AddDays(30), bundleId: bundle, type: type);

        await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction)));

        Assert.Empty(harness.Store.Purchases);
        Assert.Equal(0, harness.Apple.Calls);
    }

    [Fact]
    public async Task Verify_RefusesATransactionThatAppleDidNotSign()
    {
        var harness = new Harness(_pki);
        using var stranger = new AppleTestPki(Now);
        var transaction = harness.ActiveFor(UserA);

        await Assert.ThrowsAsync<AppleSignatureException>(() => harness.Service.VerifyAsync(UserA, stranger.Sign(AppleTestData.TransactionPayload(transaction))));

        Assert.Empty(harness.Store.Purchases);
        Assert.Equal(0, harness.Apple.Calls);
    }

    [Fact]
    public async Task Verify_RefusesATransactionWithoutTheCallersAccountToken()
    {
        var harness = new Harness(_pki);
        var transaction = AppleTestData.Transaction(OriginalId, token: null, expires: Now.AddDays(30));
        harness.Apple.Set(AppleTestData.Snapshot(transaction));

        var exception = await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction)));

        Assert.Equal(PurchaseRejectionReason.Account, exception.Reason);
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Verify_AnotherAccountsTransaction_IsAConflict_AndNothingIsTransferred()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA);
        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));

        // B presents A's transaction (a shared receipt, a screenshot, a copied JWS).
        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => harness.Service.VerifyAsync(UserB, harness.SignedBy(transaction)));

        Assert.Equal(UserA, harness.Store.Purchases.Values.Single().UserId);
        Assert.Contains("conflict:verify", harness.Telemetry.Entries);
    }

    [Fact]
    public async Task Verify_ATokenOfAnotherLiveAccount_IsAConflict_EvenForANewTransaction()
    {
        var harness = new Harness(_pki);
        await harness.Service.GetCatalogAsync(UserA);
        await harness.Service.GetCatalogAsync(UserB);
        // A transaction bought with A's token reaches the server through B's session.
        var transaction = harness.ActiveFor(UserA);

        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => harness.Service.VerifyAsync(UserB, harness.SignedBy(transaction)));

        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Verify_IsIdempotent_TheSameTransactionTwiceIsOnePurchase()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA);

        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));
        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));

        Assert.Single(harness.Store.Purchases);
    }

    [Fact]
    public async Task Verify_ADetachedPurchase_CanBeClaimed_OnlyWhenNoLiveAccountOwnsItsToken()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA);
        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));
        // A deletes the account: the purchase is detached and the token mapping goes with the account (the Apple ID itself is untouched).
        typeof(StorePurchase).GetProperty(nameof(StorePurchase.UserId))!.SetValue(harness.Store.Purchases.Values.Single(), null);
        harness.Store.RemoveLinkOf(UserA);

        // The same person signs up again as B and restores: the token belongs to nobody alive, so a verified restore may take it over -
        // exactly the Google Play rule. (A second LIVE account could not: see the conflict tests above.)
        var result = await harness.Service.VerifyAsync(UserB, harness.SignedBy(transaction));

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        Assert.Equal(UserB, harness.Store.Purchases.Values.Single().UserId);
    }

    [Fact]
    public async Task Verify_StoreUnavailable_FailsCleanly_AndWritesNothing()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA);
        harness.Apple.Fail(OriginalId, new AppleUnavailableException("down"));

        await Assert.ThrowsAsync<AppleUnavailableException>(() => harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction)));

        Assert.Empty(harness.Store.Purchases);
        Assert.Contains("appleFailed", string.Join(",", harness.Telemetry.Entries.DefaultIfEmpty("appleFailed")));
    }

    [Fact]
    public async Task Verify_Disabled_Throws()
    {
        var harness = new Harness(_pki, AppleTestData.Options(enabled: false));

        await Assert.ThrowsAsync<BillingNotEnabledException>(() => harness.Service.VerifyAsync(UserA, "x"));
    }

    [Fact]
    public async Task Restore_VerifiesEachTransaction_AndReportsWhatItFound()
    {
        var harness = new Harness(_pki);
        var monthly = harness.ActiveFor(UserA, "1000000000000001");
        var junk = AppleTestData.Transaction("1000000000000002", "com.other.product", harness.TokenOf(UserA), expires: Now.AddDays(5));

        var result = await harness.Service.RestoreAsync(UserA, [harness.SignedBy(monthly), harness.SignedBy(junk), "not-a-jws"]);

        Assert.Equal(AppleRestoreOutcome.Restored, result.Outcome);
        Assert.Single(harness.Store.Purchases);
    }

    [Fact]
    public async Task Restore_WithNothing_RefreshesTheAccountsOwnPurchasesFromTheStore()
    {
        var harness = new Harness(_pki);
        var transaction = harness.ActiveFor(UserA);
        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));
        // Later the subscription renews in the store.
        harness.Apple.Set(AppleTestData.Snapshot(transaction with { ExpiresDateUtc = Now.AddDays(60) }));

        var result = await harness.Service.RestoreAsync(UserA, []);

        Assert.Equal(AppleRestoreOutcome.Restored, result.Outcome);
        Assert.Equal(Now.AddDays(60), harness.Store.Purchases.Values.Single().AccessEndsAtUtc);
    }

    [Fact]
    public async Task Restore_NothingToFind_AndANoticeOfAConflictOrOutage()
    {
        var harness = new Harness(_pki);
        Assert.Equal(AppleRestoreOutcome.NothingFound, (await harness.Service.RestoreAsync(UserA, [])).Outcome);

        var transaction = harness.ActiveFor(UserA);
        await harness.Service.VerifyAsync(UserA, harness.SignedBy(transaction));
        Assert.Equal(AppleRestoreOutcome.BelongsToAnotherJupleAccount, (await harness.Service.RestoreAsync(UserB, [harness.SignedBy(transaction)])).Outcome);

        harness.Apple.Fail(OriginalId, new AppleUnavailableException("down"));
        var fresh = new Harness(_pki);
        var other = fresh.ActiveFor(UserA, "1000000000000009");
        fresh.Apple.Fail("1000000000000009", new AppleUnavailableException("down"));
        Assert.Equal(AppleRestoreOutcome.TemporaryFailure, (await fresh.Service.RestoreAsync(UserA, [fresh.SignedBy(other)])).Outcome);
    }

    [Fact]
    public async Task AnExpiredOrRevokedTransaction_NeverReactivatesAccess_OnRestore()
    {
        var harness = new Harness(_pki);
        var revoked = AppleTestData.Transaction(OriginalId, token: harness.TokenOf(UserA), expires: Now.AddDays(20), revoked: Now.AddDays(-1));
        harness.Apple.Set(AppleTestData.Snapshot(revoked, AppleSubscriptionStatus.Revoked));

        var result = await harness.Service.RestoreAsync(UserA, [harness.SignedBy(revoked)]);

        Assert.Equal(AppleRestoreOutcome.NothingFound, result.Outcome);
        Assert.Equal(StorePurchaseState.Revoked, harness.Store.Purchases.Values.Single().State);
    }

    [Fact]
    public void Handle_RoundTrips_AndIsSealed_AndRefusesAForeignBlob()
    {
        var harness = new Harness(_pki);
        var handle = ApplePayloads.ToHandle(AppleEnvironment.Sandbox, "12345");

        var sealedHandle = harness.Handles.Seal(handle);

        Assert.Equal((AppleEnvironment.Sandbox, "12345"), ApplePayloads.FromHandle(harness.Handles.Open(sealedHandle)));
        Assert.DoesNotContain("12345", System.Text.Encoding.UTF8.GetString(sealedHandle));
        // A blob sealed under the GOOGLE key cannot be opened with the Apple key (separate keys, separate purposes).
        var googleSealed = new PurchaseTokenProtector(new BillingOptions { Google = new GoogleBillingOptions { PurchaseTokenEncryptionKey = GoogleTestData.Key32C } }).Seal(handle);
        Assert.Throws<PurchaseTokenTamperedException>(() => harness.Handles.Open(googleSealed));
        Assert.Throws<AppleMalformedException>(() => ApplePayloads.FromHandle("no-separator"));
    }
}
