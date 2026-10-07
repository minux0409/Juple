using System.Text;
using Juple.Api.Controllers;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;

namespace Juple.UnitTests.Billing.GooglePlay;

public sealed class GoogleBillingProcessorTests
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private const long UserA = 101;
    private const string Token = "token-A-0123456789";

    private sealed class Harness
    {
        public BillingOptions Options { get; } = GoogleTestData.Options();
        public FakeGooglePlayClient Google { get; } = new();
        public FakeGoogleBillingStore Store { get; } = new();
        public FakeTelemetry Telemetry { get; } = new();
        public FakeSignal Signal { get; } = new();
        public StubTime Time { get; } = new(Now);
        public IPurchaseTokenProtector Tokens { get; }
        public GoogleAccountIdProvider Accounts { get; }
        public GoogleBillingProcessor Processor { get; }

        public Harness()
        {
            Tokens = new PurchaseTokenProtector(Options);
            Accounts = new GoogleAccountIdProvider(Options);
            Processor = new GoogleBillingProcessor(Options, Google, Store, Tokens, Signal, Telemetry, Time);
        }

        public string KeyOf(long userId)
        {
            var key = Accounts.Compute(userId);
            Store.AddLink(userId, key);
            return key;
        }

        public Task<StoreEventInsertResult> Ingest(string messageId, string token = Token, string type = "subscription:4") =>
            Processor.IngestAsync(messageId, new GoogleNotification(type, token, Now), CancellationToken.None);
    }

    [Fact]
    public async Task Ingest_PersistsTheEventBeforeAnySignal_AndRecordsTheDispatch()
    {
        var harness = new Harness();

        var inserted = await harness.Ingest("msg-1");

        Assert.True(inserted.IsNew);
        var storeEvent = harness.Store.Events[inserted.Id];
        Assert.Equal(StoreEventResult.Pending, storeEvent.Result);
        Assert.NotNull(storeEvent.DispatchedAtUtc);
        Assert.Equal([inserted.Id], harness.Signal.Signalled);
        // Sealed token only - and only the hash is searchable.
        Assert.Equal(Token, harness.Tokens.Open(storeEvent.EncryptedToken!));
        Assert.Equal(harness.Tokens.Hash(Token), storeEvent.TokenHash);
    }

    [Fact]
    public async Task IfTheQueueIsDown_TheEventIsStillInSql_UndispatchedAndRecoverableBySweep()
    {
        var harness = new Harness();
        harness.Signal.Succeeds = false;
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));

        var inserted = await harness.Ingest("msg-1");

        Assert.Null(harness.Store.Events[inserted.Id].DispatchedAtUtc);
        var summary = await harness.Processor.SweepAsync(10, 10);
        Assert.Equal(1, summary.EventsProcessed);
        Assert.Equal(StoreEventResult.Processed, harness.Store.Events[inserted.Id].Result);
        Assert.Equal(UserA, Assert.Single(harness.Store.Purchases.Values).UserId);
    }

    [Fact]
    public async Task ADuplicateDelivery_IsTheSameEvent_NotASecondOne_AndIsNotSignalledAgain()
    {
        var harness = new Harness();

        var first = await harness.Ingest("msg-1");
        var second = await harness.Ingest("msg-1");

        Assert.Equal(first.Id, second.Id);
        Assert.False(second.IsNew);
        Assert.Single(harness.Store.Events);
        Assert.Single(harness.Signal.Signalled);
    }

    [Fact]
    public async Task Processing_RefetchesTheAuthoritativeState_NeverTrustingTheNotificationType()
    {
        var harness = new Harness();
        // The notification says "subscription:13" (EXPIRED) - but Google's CURRENT state is Active. Only Google's state is applied.
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1", type: "subscription:13");

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Processed, outcome);
        Assert.Equal(StorePurchaseState.Active, Assert.Single(harness.Store.Purchases.Values).State);
        Assert.Equal(1, harness.Google.GetCalls);
    }

    [Fact]
    public async Task OutOfOrderNotifications_ConvergeOnGoogleCurrentState()
    {
        var harness = new Harness();
        var key = harness.KeyOf(UserA);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(30)));
        var renewed = await harness.Ingest("msg-newer", type: "subscription:2");
        var expiredLate = await harness.Ingest("msg-older", type: "subscription:13");

        // The "newer" arrives first, then the stale "older" one - but both just ask Google, whose answer changes in between.
        await harness.Processor.ProcessEventAsync(renewed.Id);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Canceled, key, Now.AddDays(30), ackPending: false));
        await harness.Processor.ProcessEventAsync(expiredLate.Id);

        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(StorePurchaseState.Canceled, purchase.State);
        Assert.Equal(Now.AddDays(30), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task AWorkerDuplicateDelivery_DoesNothingTheSecondTime()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1");

        var first = await harness.Processor.ProcessEventAsync(inserted.Id);
        var second = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Processed, first);
        Assert.Equal(ProcessOutcome.NotTaken, second);
        Assert.Equal(1, harness.Google.GetCalls);
        Assert.Single(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task AProcessedEvent_NoLongerKeepsTheSealedToken()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1");

        await harness.Processor.ProcessEventAsync(inserted.Id);

        var storeEvent = harness.Store.Events[inserted.Id];
        Assert.Null(storeEvent.EncryptedToken);
        Assert.NotNull(storeEvent.ProcessedAtUtc);
    }

    [Fact]
    public async Task ARenewalNotification_AttachesToTheKnownPurchasesAccount()
    {
        var harness = new Harness();
        var key = harness.KeyOf(UserA);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(1), ackPending: false));
        await harness.Ingest("msg-1");
        await harness.Processor.ProcessEventAsync(harness.Store.Events.Keys.Single());
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(31), ackPending: false));
        var renewal = await harness.Ingest("msg-2", type: "subscription:2");

        await harness.Processor.ProcessEventAsync(renewal.Id);

        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(UserA, purchase.UserId);
        Assert.Equal(Now.AddDays(31), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task ANewPurchaseWhoseAppNeverReachedVerify_IsTiedByTheOpaqueAccountId_AndAcknowledged()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1", type: "subscription:4");

        await harness.Processor.ProcessEventAsync(inserted.Id);

        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(UserA, purchase.UserId);
        Assert.Equal([Token], harness.Google.Acknowledged);
    }

    [Fact]
    public async Task AResubscription_IsTiedThroughTheLinkedPurchaseToken()
    {
        var harness = new Harness();
        var key = harness.KeyOf(UserA);
        harness.Google.Set("old-token", GoogleTestData.Snapshot(GoogleSubscriptionState.Expired, key, Now.AddDays(-5), ackPending: false));
        await harness.Ingest("msg-old", "old-token");
        await harness.Processor.ProcessEventAsync(harness.Store.Events.Keys.Single());
        // The new token carries NO account id (as can happen on a re-signup), only the link to the old purchase.
        harness.Google.Set("new-token", GoogleTestData.Snapshot(GoogleSubscriptionState.Active, "unrelated", Now.AddDays(30), linkedPurchaseToken: "old-token"));
        var inserted = await harness.Ingest("msg-new", "new-token");

        await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(2, harness.Store.Purchases.Count);
        Assert.All(harness.Store.Purchases.Values, purchase => Assert.Equal(UserA, purchase.UserId));
    }

    [Fact]
    public async Task APurchaseThatCannotBeTiedToAnyAccount_IsNeverGuessed_ItStaysUnlinked()
    {
        var harness = new Harness();
        harness.KeyOf(UserA);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, "an-id-nobody-has", Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1");

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Unlinked, outcome);
        Assert.Empty(harness.Store.Purchases);
        Assert.Empty(harness.Google.Acknowledged);
        Assert.Equal(StoreEventResult.Unlinked, harness.Store.Events[inserted.Id].Result);
    }

    [Fact]
    public async Task APurchaseOfAnotherProduct_IsIgnored_NeverAttached()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30), productId: "other_product"));
        var inserted = await harness.Ingest("msg-1");

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Ignored, outcome);
        Assert.Empty(harness.Store.Purchases);
    }

    [Fact]
    public async Task ATestNotification_CarriesNothingToReconcile()
    {
        var harness = new Harness();
        var inserted = await harness.Processor.IngestAsync("msg-test", new GoogleNotification("test", null, Now));

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Ignored, outcome);
        Assert.Equal(0, harness.Google.GetCalls);
    }

    [Fact]
    public async Task AGoogleOutage_SchedulesAnSqlRetryWithBackoff_AndTheEventStaysPending()
    {
        var harness = new Harness();
        harness.Google.Fail(Token, new GooglePlayUnavailableException("503"));
        var inserted = await harness.Ingest("msg-1");

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.RetryScheduled, outcome);
        var storeEvent = harness.Store.Events[inserted.Id];
        Assert.Null(storeEvent.ProcessedAtUtc);
        Assert.Equal(1, storeEvent.AttemptCount);
        Assert.True(storeEvent.NextAttemptAtUtc > Now);
        // Not yet due: the sweep leaves it; once due and Google is back, the same event is retried and processed.
        Assert.Equal(0, (await harness.Processor.SweepAsync(10, 10)).EventsProcessed);
        harness.Google.ClearFailure(Token);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        harness.Time.Now = Now.AddDays(1);

        var summary = await harness.Processor.SweepAsync(10, 10);

        Assert.Equal(1, summary.EventsProcessed);
        Assert.Equal(StoreEventResult.Processed, storeEvent.Result);
        Assert.Equal(UserA, Assert.Single(harness.Store.Purchases.Values).UserId);
    }

    [Fact]
    public async Task ATamperedSealedToken_FailsPermanently_NeverRetriedForever()
    {
        var harness = new Harness();
        var storeEvent = new StoreEvent(StoreSource.GooglePlay, "msg-bad", "subscription:4", harness.Tokens.Hash(Token), new byte[64], Now);
        var inserted = await harness.Store.TryInsertEventAsync(storeEvent);

        var outcome = await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.FailedPermanent, outcome);
        Assert.Equal(StoreEventResult.FailedPermanent, storeEvent.Result);
        Assert.Null(storeEvent.EncryptedToken);
    }

    [Fact]
    public async Task GoogleForgettingAnOldToken_EndsTheKnownPurchase_AtItsEarliestKnownEnd()
    {
        var harness = new Harness();
        var key = harness.KeyOf(UserA);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(1), ackPending: false));
        var first = await harness.Ingest("msg-1");
        await harness.Processor.ProcessEventAsync(first.Id);
        // 60 days later Google no longer knows the token.
        harness.Time.Now = Now.AddDays(60);
        harness.Google.Fail(Token, new GooglePlayPurchaseNotFoundException());
        var later = await harness.Ingest("msg-2");

        await harness.Processor.ProcessEventAsync(later.Id);

        var purchase = Assert.Single(harness.Store.Purchases.Values);
        Assert.Equal(StorePurchaseState.Expired, purchase.State);
        Assert.Equal(Now.AddDays(1), purchase.AccessEndsAtUtc);
    }

    [Fact]
    public async Task TheSweep_ReconcilesDuePurchases_AndRetriesAPendingAcknowledgement()
    {
        var harness = new Harness();
        var key = harness.KeyOf(UserA);
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(30)));
        harness.Google.AcknowledgeFailure = new GooglePlayUnavailableException("503");
        var first = await harness.Ingest("msg-1");
        await harness.Processor.ProcessEventAsync(first.Id);
        Assert.True(harness.Store.Purchases.Values.Single().AcknowledgementPending);

        harness.Google.AcknowledgeFailure = null;
        harness.Time.Now = Now.AddDays(2);
        var summary = await harness.Processor.SweepAsync(10, 10);

        Assert.Equal(1, summary.PurchasesReconciled);
        Assert.False(harness.Store.Purchases.Values.Single().AcknowledgementPending);
        Assert.Single(harness.Google.Acknowledged);
    }

    [Fact]
    public async Task TelemetryNeverCarriesTheToken()
    {
        var harness = new Harness();
        harness.Google.Set(Token, GoogleTestData.Snapshot(GoogleSubscriptionState.Active, harness.KeyOf(UserA), Now.AddDays(30)));
        var inserted = await harness.Ingest("msg-1");
        await harness.Processor.ProcessEventAsync(inserted.Id);

        Assert.DoesNotContain(harness.Telemetry.Entries, entry => entry.Contains(Token, StringComparison.Ordinal));
    }
}

public sealed class GoogleRtdnTests
{
    private static string Envelope(object notification, string messageId = "msg-1")
    {
        var data = Convert.ToBase64String(Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(notification)));
        return System.Text.Json.JsonSerializer.Serialize(new { message = new { data, messageId }, subscription = "projects/p/subscriptions/s" });
    }

    private static object SubscriptionNotification(string package = "com.juple.app", string token = "tok", int type = 4) => new
    {
        version = "1.0",
        packageName = package,
        eventTimeMillis = "1788000000000",
        subscriptionNotification = new { version = "1.0", notificationType = type, purchaseToken = token, subscriptionId = "juple_monthly" },
    };

    private sealed class FakeAuthenticator(bool result) : IPubSubPushAuthenticator
    {
        public int Calls { get; private set; }

        public Task<bool> AuthenticateAsync(string? authorizationHeader, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(result);
        }
    }

    private sealed class RecordingProcessor : IGoogleBillingProcessor
    {
        public List<(string MessageId, GoogleNotification Notification)> Ingested { get; } = [];

        public Task<StoreEventInsertResult> IngestAsync(string messageId, GoogleNotification notification, CancellationToken cancellationToken = default)
        {
            Ingested.Add((messageId, notification));
            return Task.FromResult(new StoreEventInsertResult(Ingested.Count, IsNew: true));
        }

        public Task<ProcessOutcome> ProcessEventAsync(long eventId, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<ProcessOutcome> ReconcilePurchaseAsync(long purchaseId, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<SweepSummary> SweepAsync(int eventLimit, int purchaseLimit, CancellationToken cancellationToken = default) => throw new NotSupportedException();
    }

    /// <summary>A body that must never be read: proves the request is refused BEFORE the body is parsed.</summary>
    private sealed class UnreadableBody : Stream
    {
        public bool WasRead { get; private set; }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count) { WasRead = true; throw new InvalidOperationException("read"); }
        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken) { WasRead = true; throw new InvalidOperationException("read"); }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default) { WasRead = true; throw new InvalidOperationException("read"); }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    private static GoogleRtdnController Controller(BillingOptions options, IPubSubPushAuthenticator authenticator, IGoogleBillingProcessor processor, Stream body)
    {
        var controller = new GoogleRtdnController(options, authenticator, processor)
        {
            ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() },
        };
        controller.HttpContext.Request.Body = body;
        return controller;
    }

    private static Stream Body(string text) => new MemoryStream(Encoding.UTF8.GetBytes(text));

    [Fact]
    public async Task AnUnauthenticatedPush_IsRefusedBeforeTheBodyIsRead()
    {
        var body = new UnreadableBody();
        var processor = new RecordingProcessor();

        var result = await Controller(GoogleTestData.Options(), new FakeAuthenticator(false), processor, body).ReceiveAsync(CancellationToken.None);

        Assert.IsType<UnauthorizedResult>(result);
        Assert.False(body.WasRead);
        Assert.Empty(processor.Ingested);
    }

    [Fact]
    public async Task WhileGoogleBillingIsDisabled_TheEndpointDoesNotExist()
    {
        var authenticator = new FakeAuthenticator(true);

        var result = await Controller(GoogleTestData.Options(enabled: false), authenticator, new RecordingProcessor(), Body("{}")).ReceiveAsync(CancellationToken.None);

        Assert.IsType<NotFoundResult>(result);
        Assert.Equal(0, authenticator.Calls);
    }

    [Fact]
    public async Task AValidSubscriptionPush_IsIngestedWithItsMessageIdAndToken()
    {
        var processor = new RecordingProcessor();

        var result = await Controller(GoogleTestData.Options(), new FakeAuthenticator(true), processor, Body(Envelope(SubscriptionNotification(token: "the-token", type: 13), "message-77"))).ReceiveAsync(CancellationToken.None);

        Assert.IsType<OkResult>(result);
        var (messageId, notification) = Assert.Single(processor.Ingested);
        Assert.Equal("message-77", messageId);
        Assert.Equal("subscription:13", notification.EventType);
        Assert.Equal("the-token", notification.PurchaseToken);
    }

    [Fact]
    public async Task ANotificationForAnotherPackage_IsRejected_AndNothingIsStored()
    {
        var processor = new RecordingProcessor();

        var result = await Controller(GoogleTestData.Options(), new FakeAuthenticator(true), processor, Body(Envelope(SubscriptionNotification(package: "com.someone.else")))).ReceiveAsync(CancellationToken.None);

        Assert.IsType<BadRequestResult>(result);
        Assert.Empty(processor.Ingested);
    }

    [Theory]
    [InlineData("")]
    [InlineData("not json")]
    [InlineData("{}")]
    [InlineData("{\"message\":{\"data\":\"!!!notbase64\",\"messageId\":\"m\"}}")]
    [InlineData("{\"message\":{\"data\":\"e30=\",\"messageId\":\"\"}}")]
    public async Task AMalformedEnvelope_IsRejected(string body)
    {
        var processor = new RecordingProcessor();

        var result = await Controller(GoogleTestData.Options(), new FakeAuthenticator(true), processor, Body(body)).ReceiveAsync(CancellationToken.None);

        Assert.IsType<BadRequestResult>(result);
        Assert.Empty(processor.Ingested);
    }

    [Fact]
    public async Task AnOversizedBody_IsRejected()
    {
        var result = await Controller(GoogleTestData.Options(), new FakeAuthenticator(true), new RecordingProcessor(), Body(new string('x', 70 * 1024))).ReceiveAsync(CancellationToken.None);

        Assert.IsType<BadRequestResult>(result);
    }

    [Fact]
    public void ParseNotification_Kinds()
    {
        static string Encode(object value) => Convert.ToBase64String(Encoding.UTF8.GetBytes(System.Text.Json.JsonSerializer.Serialize(value)));

        var voided = GoogleRtdnController.ParseNotification(Encode(new { packageName = "com.juple.app", voidedPurchaseNotification = new { purchaseToken = "v", orderId = "o", productType = 1, refundType = 1 } }), "com.juple.app");
        var test = GoogleRtdnController.ParseNotification(Encode(new { packageName = "com.juple.app", testNotification = new { version = "1.0" } }), "com.juple.app");
        var oneTime = GoogleRtdnController.ParseNotification(Encode(new { packageName = "com.juple.app", oneTimeProductNotification = new { purchaseToken = "o" } }), "com.juple.app");
        var noToken = GoogleRtdnController.ParseNotification(Encode(new { packageName = "com.juple.app", subscriptionNotification = new { notificationType = 4 } }), "com.juple.app");

        Assert.Equal(("voided", "v"), (voided!.EventType, voided.PurchaseToken));
        Assert.Equal(("test", (string?)null), (test!.EventType, test.PurchaseToken));
        Assert.Equal("oneTimeProduct", oneTime!.EventType);
        Assert.Null(noToken);
    }
}
