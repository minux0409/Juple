using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Juple.UnitTests.Billing.GooglePlay;

namespace Juple.UnitTests.Billing.Apple;

public sealed class AppleBillingProcessorTests : IDisposable
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private const long UserA = 101;
    private const string OriginalId = "1000000000000001";

    private readonly AppleTestPki _pki = new(Now);

    public void Dispose() => _pki.Dispose();

    private sealed class Harness
    {
        public Harness(AppleTestPki pki)
        {
            Options = AppleTestData.Options();
            Pki = pki;
            Time = new StubTime(Now);
            Tokens = new AppleAccountTokenProvider(Options);
            Handles = new ApplePurchaseHandleProtector(Options);
            Processor = new AppleBillingProcessor(Options, Apple, pki.Verifier(Time), Store, Handles, Signal, Telemetry, Time);
        }

        public AppleTestPki Pki { get; }
        public BillingOptions Options { get; }
        public StubTime Time { get; }
        public FakeAppleStoreServerClient Apple { get; } = new();
        public FakeAppleBillingStore Store { get; } = new();
        public FakeSignal Signal { get; } = new();
        public FakeTelemetry Telemetry { get; } = new();
        public AppleAccountTokenProvider Tokens { get; }
        public ApplePurchaseHandleProtector Handles { get; }
        public AppleBillingProcessor Processor { get; }

        public Guid TokenOf(long userId) => Tokens.Compute(userId);

        public string Signed(AppleTransaction transaction) => Pki.Sign(AppleTestData.TransactionPayload(transaction));

        public string Notification(string uuid, string type, string? subtype, AppleTransaction? transaction, string bundleId = AppleTestData.Bundle, AppleEnvironment environment = AppleEnvironment.Production) =>
            Pki.Sign(AppleTestData.NotificationPayload(uuid, type, subtype, transaction is null ? null : Signed(transaction), bundleId, environment));

        public AppleTransaction Active(long? userId, DateTimeOffset? expires = null, AppleSubscriptionStatus status = AppleSubscriptionStatus.Active, string id = OriginalId)
        {
            var transaction = AppleTestData.Transaction(id, AppleTestData.Yearly, userId is null ? null : TokenOf(userId.Value), expires: expires ?? Now.AddDays(30));
            Apple.Set(AppleTestData.Snapshot(transaction, status, new AppleRenewalInfo(id, null, true, null, null, null)));
            return transaction;
        }
    }

    [Fact]
    public async Task Ingest_StoresTheNotificationDurably_Idempotently_AndWakesTheWorker()
    {
        var harness = new Harness(_pki);
        var transaction = harness.Active(UserA);
        var payload = harness.Notification("uuid-1", "DID_RENEW", null, transaction);

        var first = await harness.Processor.IngestAsync(payload);
        var redelivery = await harness.Processor.IngestAsync(payload);

        Assert.Equal(AppleIngestOutcome.Accepted, first.Outcome);
        Assert.True(first.Event!.IsNew);
        Assert.False(redelivery.Event!.IsNew);
        var stored = Assert.Single(harness.Store.Events.Values);
        Assert.Equal(StoreSource.AppStore, stored.Source);
        Assert.Equal("uuid-1", stored.ExternalEventId);
        Assert.Equal("DID_RENEW", stored.EventType);
        Assert.Equal([first.Event.Id], harness.Signal.Signalled);
        Assert.NotNull(stored.EncryptedToken);
        // Nothing is granted by ingesting: no purchase exists until the event is PROCESSED against the store.
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Ingest_RecordsTheNotificationTypeWithItsSubtype()
    {
        var harness = new Harness(_pki);

        await harness.Processor.IngestAsync(harness.Notification("uuid-2", "DID_CHANGE_RENEWAL_STATUS", "AUTO_RENEW_DISABLED", harness.Active(UserA)));

        Assert.Equal("DID_CHANGE_RENEWAL_STATUS:AUTO_RENEW_DISABLED", harness.Store.Events.Values.Single().EventType);
    }

    [Fact]
    public async Task Ingest_AFailedWakeUpLosesNothing_TheEventStaysAndTheSweepTakesIt()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        harness.Signal.Succeeds = false;
        var transaction = harness.Active(UserA);

        await harness.Processor.IngestAsync(harness.Notification("uuid-3", "SUBSCRIBED", "INITIAL_BUY", transaction));
        var summary = await harness.Processor.SweepAsync(10, 10);

        Assert.Equal(1, summary.EventsProcessed);
        Assert.Equal(UserA, harness.Store.Purchases.Values.Single().UserId);
    }

    [Fact]
    public async Task Ingest_ARefusesWhatIsNotSignedByApple_AndStoresNothing()
    {
        var harness = new Harness(_pki);
        using var stranger = new AppleTestPki(Now);
        var forged = stranger.Sign(AppleTestData.NotificationPayload("uuid-x", "REFUND", null, stranger.Sign(AppleTestData.TransactionPayload(harness.Active(UserA)))));

        await Assert.ThrowsAsync<AppleSignatureException>(() => harness.Processor.IngestAsync(forged));

        Assert.Empty(harness.Store.Events);
    }

    [Fact]
    public async Task Ingest_AcknowledgesButNeverActsOn_AnotherAppOrAnUnacceptedEnvironment()
    {
        var harness = new Harness(_pki);
        var transaction = harness.Active(UserA);

        var otherApp = await harness.Processor.IngestAsync(harness.Notification("uuid-4", "DID_RENEW", null, transaction, bundleId: "com.someone.else"));

        harness.Options.Apple.AcceptSandbox = false;
        var sandbox = await harness.Processor.IngestAsync(harness.Notification("uuid-5", "DID_RENEW", null, transaction, environment: AppleEnvironment.Sandbox));

        Assert.Equal(AppleIngestOutcome.Ignored, otherApp.Outcome);
        Assert.Equal(AppleIngestOutcome.Ignored, sandbox.Outcome);
        Assert.Empty(harness.Store.Events);
    }

    [Fact]
    public async Task ATestNotification_IsRecorded_AndProcessedAsIgnored()
    {
        var harness = new Harness(_pki);

        var ingested = await harness.Processor.IngestAsync(harness.Notification("uuid-t", "TEST", null, null));
        var outcome = await harness.Processor.ProcessEventAsync(ingested.Event!.Id);

        Assert.Equal(AppleIngestOutcome.Accepted, ingested.Outcome);
        Assert.Equal(ProcessOutcome.Ignored, outcome);
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Process_AppliesTheStoresAnswer_NotTheNotificationType()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        // The notification SAYS refund, but Apple's authoritative status is a healthy active subscription: the status wins.
        var transaction = harness.Active(UserA);
        var ingested = await harness.Processor.IngestAsync(harness.Notification("uuid-6", "REFUND", null, transaction));

        var outcome = await harness.Processor.ProcessEventAsync(ingested.Event!.Id);

        Assert.Equal(ProcessOutcome.Processed, outcome);
        Assert.Equal(StorePurchaseState.Active, harness.Store.Purchases.Values.Single().State);
    }

    [Fact]
    public async Task Process_ARefund_EndsAccess_WhenTheStoreSaysRevoked()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var transaction = harness.Active(UserA);
        var first = await harness.Processor.IngestAsync(harness.Notification("uuid-7", "SUBSCRIBED", "INITIAL_BUY", transaction));
        await harness.Processor.ProcessEventAsync(first.Event!.Id);
        Assert.Equal(StorePurchaseState.Active, harness.Store.Purchases.Values.Single().State);

        var revoked = transaction with { RevocationDateUtc = Now.AddMinutes(-5) };
        harness.Apple.Set(AppleTestData.Snapshot(revoked, AppleSubscriptionStatus.Revoked));
        var refund = await harness.Processor.IngestAsync(harness.Notification("uuid-8", "REFUND", null, revoked));
        await harness.Processor.ProcessEventAsync(refund.Event!.Id);

        var purchase = harness.Store.Purchases.Values.Single();
        Assert.Equal(StorePurchaseState.Revoked, purchase.State);
        Assert.Equal(EntitlementReason.Refunded, purchase.Reason);
        Assert.Equal(Now.AddMinutes(-5), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task Process_ANewPurchase_IsTiedToAnAccountOnlyByItsAppAccountToken()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var mine = harness.Active(UserA, id: "1000000000000001");
        var stray = harness.Active(null, id: "1000000000000002");
        var unknownToken = AppleTestData.Transaction("1000000000000003", AppleTestData.Monthly, Guid.NewGuid(), expires: Now.AddDays(5));
        harness.Apple.Set(AppleTestData.Snapshot(unknownToken));

        var linked = await harness.Processor.IngestAsync(harness.Notification("u-a", "SUBSCRIBED", "INITIAL_BUY", mine));
        var noToken = await harness.Processor.IngestAsync(harness.Notification("u-b", "SUBSCRIBED", "INITIAL_BUY", stray));
        var strangerToken = await harness.Processor.IngestAsync(harness.Notification("u-c", "SUBSCRIBED", "INITIAL_BUY", unknownToken));

        Assert.Equal(ProcessOutcome.Processed, await harness.Processor.ProcessEventAsync(linked.Event!.Id));
        Assert.Equal(ProcessOutcome.Unlinked, await harness.Processor.ProcessEventAsync(noToken.Event!.Id));
        Assert.Equal(ProcessOutcome.Unlinked, await harness.Processor.ProcessEventAsync(strangerToken.Event!.Id));

        // Only the evidenced one became a purchase; the others are never attached to anybody.
        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(UserA, purchase.UserId);
    }

    [Fact]
    public async Task Process_AProductThatIsNotAJupleMembership_IsIgnored()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var other = AppleTestData.Transaction(OriginalId, "com.juple.app.coins", harness.TokenOf(UserA), expires: Now.AddDays(5));
        harness.Apple.Set(AppleTestData.Snapshot(other));
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-p", "SUBSCRIBED", null, other));

        Assert.Equal(ProcessOutcome.Ignored, await harness.Processor.ProcessEventAsync(ingested.Event!.Id));
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Process_ATransientStoreFailure_SchedulesARetry_AndSucceedsLater()
    {
        var harness = new Harness(_pki);
        var transaction = harness.Active(UserA);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        harness.Apple.Fail(OriginalId, new AppleUnavailableException("429"));
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-r", "DID_RENEW", null, transaction));

        var first = await harness.Processor.ProcessEventAsync(ingested.Event!.Id);
        Assert.Equal(ProcessOutcome.RetryScheduled, first);
        Assert.Empty(harness.Store.Purchases);
        // Not due yet.
        Assert.Equal(ProcessOutcome.NotTaken, await harness.Processor.ProcessEventAsync(ingested.Event.Id));

        harness.Apple.ClearFailure(OriginalId);
        harness.Time.Now = Now.AddHours(7);
        var second = await harness.Processor.ProcessEventAsync(ingested.Event.Id);

        Assert.Equal(ProcessOutcome.Processed, second);
        Assert.Single(harness.Store.Purchases);
    }

    [Fact]
    public async Task Process_AMalformedStoreAnswer_IsRetried_NeverGuessed()
    {
        var harness = new Harness(_pki);
        var transaction = harness.Active(UserA);
        harness.Apple.Fail(OriginalId, new AppleMalformedException("bad"));
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-m", "DID_RENEW", null, transaction));

        Assert.Equal(ProcessOutcome.RetryScheduled, await harness.Processor.ProcessEventAsync(ingested.Event!.Id));
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task Reconcile_PicksUpARenewalTheNotificationNeverArrivedFor()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var transaction = harness.Active(UserA, expires: Now.AddHours(1));
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-s", "SUBSCRIBED", "INITIAL_BUY", transaction));
        await harness.Processor.ProcessEventAsync(ingested.Event!.Id);

        // The renewal happens; its DID_RENEW notification is lost. The periodic check finds it.
        harness.Apple.Set(AppleTestData.Snapshot(transaction with { ExpiresDateUtc = Now.AddDays(31) }));
        harness.Time.Now = Now.AddHours(2);
        var summary = await harness.Processor.SweepAsync(10, 10);

        Assert.Equal(1, summary.PurchasesReconciled);
        Assert.Equal(Now.AddDays(31), harness.Store.Purchases.Values.Single().AccessEndsAtUtc);
    }

    [Fact]
    public async Task Reconcile_AStoreThatForgotTheTransaction_EndsThePurchase_AtItsEarliestKnownEnd()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var transaction = harness.Active(UserA, expires: Now.AddDays(1));
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-f", "SUBSCRIBED", null, transaction));
        await harness.Processor.ProcessEventAsync(ingested.Event!.Id);
        var purchaseId = harness.Store.Purchases.Keys.Single();

        harness.Apple.Fail(OriginalId, new AppleTransactionNotFoundException());
        harness.Time.Now = Now.AddDays(5);
        var outcome = await harness.Processor.ReconcilePurchaseAsync(purchaseId);

        Assert.Equal(ProcessOutcome.Processed, outcome);
        var purchase = harness.Store.Purchases[purchaseId];
        Assert.Equal(StorePurchaseState.Expired, purchase.State);
        Assert.Equal(Now.AddDays(1), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task Reconcile_AnUnavailableStore_ChangesNothing()
    {
        var harness = new Harness(_pki);
        await harness.Store.EnsureAccountLinkAsync(UserA, harness.TokenOf(UserA).ToString("D"), Now);
        var transaction = harness.Active(UserA);
        var ingested = await harness.Processor.IngestAsync(harness.Notification("u-u", "SUBSCRIBED", null, transaction));
        await harness.Processor.ProcessEventAsync(ingested.Event!.Id);
        var purchaseId = harness.Store.Purchases.Keys.Single();
        var before = harness.Store.Purchases[purchaseId].AccessEndsAtUtc;

        harness.Apple.Fail(OriginalId, new AppleUnavailableException("down"));

        Assert.Equal(ProcessOutcome.RetryScheduled, await harness.Processor.ReconcilePurchaseAsync(purchaseId));
        Assert.Equal(before, harness.Store.Purchases[purchaseId].AccessEndsAtUtc);
    }
}
