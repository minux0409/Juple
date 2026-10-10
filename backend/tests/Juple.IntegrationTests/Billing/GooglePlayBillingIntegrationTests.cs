using System.Security.Cryptography;
using System.Text;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Juple.Domain.Users;
using Juple.Infrastructure.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Juple.IntegrationTests.Billing;

/// <summary>
/// Google Play billing (R39-B1) against the real schema, with a scripted Google (never the network): verification and ownership,
/// the sealed token at rest, acknowledgement, concurrency, account deletion, notifications (idempotent, durable, authoritative)
/// and the effective entitlement. The store is proof of payment; these tests pin that Juple's own records are the access truth.
/// </summary>
public sealed class GooglePlayBillingIntegrationTests : IAsyncLifetime
{
    private static readonly DateTimeOffset Now = new(2026, 12, 10, 12, 0, 0, TimeSpan.Zero);
    private static readonly TrialWindow EndedTrial = new(Now.AddDays(-80), Now.AddDays(-50));

    private string _connectionString = null!;
    private JupleDbContext _db = null!;
    private long _userA;
    private long _userB;
    private readonly string _run = Guid.NewGuid().ToString("N")[..10];
    private readonly List<string> _tokens = [];
    private readonly BillingOptions _options = Options();
    private readonly FakeGoogle _google = new();

    private static BillingOptions Options() => new()
    {
        ProgramEnabled = true,
        ProgramStartAtUtc = DateTimeOffset.UnixEpoch,
        TrialIdentityHashKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        Google = new GoogleBillingOptions
        {
            Enabled = true,
            ProductId = "juple_monthly",
            BasePlanId = "monthly",
            ServiceAccountCredentialJson = "{}",
            AccountHashKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            PurchaseTokenEncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            PubSub = new GooglePubSubOptions { Audience = "https://api.example.test/rtdn", PushServiceAccountEmail = "push@example.iam.gserviceaccount.com" },
        },
    };

    private sealed class StubTime(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private readonly StubTime _time = new(Now);

    private sealed class FakeGoogle : IGooglePlayClient
    {
        private readonly Dictionary<string, GoogleSubscriptionSnapshot> _snapshots = [];
        private readonly object _gate = new();

        public List<string> Acknowledged { get; } = [];

        public Exception? AcknowledgeFailure { get; set; }

        public void Set(string token, GoogleSubscriptionSnapshot snapshot)
        {
            lock (_gate)
            {
                _snapshots[token] = snapshot;
            }
        }

        public Task<GoogleSubscriptionSnapshot> GetSubscriptionAsync(string packageName, string purchaseToken, string expectedProductId, CancellationToken cancellationToken = default)
        {
            lock (_gate)
            {
                return _snapshots.TryGetValue(purchaseToken, out var snapshot) ? Task.FromResult(snapshot) : throw new GooglePlayPurchaseNotFoundException();
            }
        }

        public Task AcknowledgeAsync(string packageName, string productId, string purchaseToken, CancellationToken cancellationToken = default)
        {
            lock (_gate)
            {
                if (AcknowledgeFailure is { } failure)
                {
                    throw failure;
                }

                Acknowledged.Add(purchaseToken);
                if (_snapshots.TryGetValue(purchaseToken, out var snapshot))
                {
                    _snapshots[purchaseToken] = snapshot with { AcknowledgementPending = false };
                }
            }

            return Task.CompletedTask;
        }
    }

    private sealed class RecordingSignal : IBillingEventSignal
    {
        public bool Succeeds { get; set; } = true;

        public Task<bool> TrySignalAsync(long eventId, CancellationToken cancellationToken = default) => Task.FromResult(Succeeds);
    }

    private sealed class SilentTelemetry : IBillingTelemetry
    {
        public void VerifyCompleted(long purchaseId, GoogleVerifyOutcome outcome, StorePurchaseState state) { }
        public void VerifyRejected(string reason) { }
        public void PurchaseConflict(string operation) { }
        public void GoogleCallFailed(string operation, string errorType) { }
        public void AcknowledgeFailed(long purchaseId) { }
        public void EventIngested(long eventId, bool isNew, string eventType) { }
        public void EventProcessed(long eventId, StoreEventResult result) { }
        public void EventRetryScheduled(long eventId, int attempt, string errorCode) { }
        public void PurchaseReconciled(long purchaseId, StorePurchaseState from, StorePurchaseState to) { }
    }

    public async Task InitializeAsync()
    {
        _connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext();
        var a = new User("ko-KR", "Asia/Seoul", null, Now.AddDays(-90), Now.AddDays(-90));
        var b = new User("ko-KR", "Asia/Seoul", null, Now.AddDays(-90), Now.AddDays(-90));
        a.SetTrial(EndedTrial);
        b.SetTrial(EndedTrial);
        _db.Users.AddRange(a, b);
        await _db.SaveChangesAsync();
        (_userA, _userB) = (a.Id, b.Id);
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        var protector = new PurchaseTokenProtector(_options);
        foreach (var token in _tokens)
        {
            var hash = protector.Hash(token);
            await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.StorePurchases WHERE ExternalKeyHash = {hash}");
        }

        await _db.Database.ExecuteSqlInterpolatedAsync($"DELETE FROM billing.StoreEvents WHERE ExternalEventId LIKE {_run + "%"}");
        foreach (var userId in new[] { _userA, _userB })
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private JupleDbContext NewContext() => new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(_connectionString).Options);

    private string NewToken(string label)
    {
        var token = $"{_run}-{label}-{Guid.NewGuid():N}";
        _tokens.Add(token);
        return token;
    }

    private string KeyOf(long userId) => new GoogleAccountIdProvider(_options).Compute(userId);

    /// <summary>What the app's catalog call does: records the account's opaque id so a notification can be tied back to it.</summary>
    private async Task LinkAsync(long userId) =>
        await new GoogleBillingStore(NewContext()).EnsureAccountLinkAsync(userId, KeyOf(userId), Now);

    private GoogleBillingService Service(JupleDbContext db) =>
        new(_options, _google, new GoogleBillingStore(db), new GoogleAccountIdProvider(_options), new PurchaseTokenProtector(_options), new SilentTelemetry(), _time);

    private GoogleBillingProcessor Processor(JupleDbContext db, IBillingEventSignal? signal = null) =>
        new(_options, _google, new GoogleBillingStore(db), new PurchaseTokenProtector(_options), signal ?? new RecordingSignal(), new SilentTelemetry(), _time);

    private EntitlementService Entitlements(JupleDbContext db) =>
        new(_options, new EntitlementStore(db), new TrialIdentityHasher(_options), _time);

    private static GoogleSubscriptionSnapshot Snapshot(
        GoogleSubscriptionState state,
        string? accountKey,
        DateTimeOffset? expiry,
        bool ackPending = true,
        string productId = "juple_monthly",
        string? basePlanId = "monthly",
        GoogleCancelSource cancel = GoogleCancelSource.None) =>
        new(state, productId, basePlanId, GooglePlanType.AutoRenewing, null, expiry, true, ackPending, accountKey, null, cancel, false);

    private async Task<StorePurchase?> PurchaseOfAsync(string token)
    {
        var hash = new PurchaseTokenProtector(_options).Hash(token);
        return await _db.StorePurchases.AsNoTracking().SingleOrDefaultAsync(purchase => purchase.ExternalKeyHash == hash);
    }

    // ---------------------------------------------------------------- verify

    [Fact]
    public async Task VerifyActive_LinksTheAccount_SealsTheToken_Acknowledges_AndTheEntitlementBecomesActive()
    {
        var token = NewToken("active");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));

        var result = await Service(_db).VerifyAsync(_userA, token);

        Assert.Equal(new GoogleVerifyResult(GoogleVerifyOutcome.Verified, StorePurchaseState.Active, Acknowledged: true), result);
        var purchase = (await PurchaseOfAsync(token))!;
        Assert.Equal(_userA, purchase.UserId);
        Assert.Equal(StorePurchaseState.Active, purchase.State);
        Assert.Equal(Now.AddDays(30), purchase.AccessEndsAtUtc);
        Assert.False(purchase.AcknowledgementPending);
        Assert.Equal([token], _google.Acknowledged);

        // The trial ended long ago; a verified purchase is what makes the account Active.
        var entitlement = await Entitlements(NewContext()).GetForUserAsync(_userA);
        Assert.Equal(EntitlementStatus.Active, entitlement.Status);
        Assert.True(entitlement.CanWrite);
        Assert.Equal(Now.AddDays(30), entitlement.CurrentPeriodEndsAtUtc);
    }

    [Fact]
    public async Task TheTokenIsNeverStoredInTheClear_AndEveryTokenColumnIsBinary()
    {
        var token = NewToken("sealed");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        await Service(_db).VerifyAsync(_userA, token);

        var purchase = (await PurchaseOfAsync(token))!;
        var plaintext = Encoding.UTF8.GetBytes(token);
        Assert.False(purchase.VerificationHandleEncrypted!.AsSpan().IndexOf(plaintext) >= 0);
        Assert.False(purchase.VerificationHandleEncrypted!.AsSpan().IndexOf(plaintext[..16]) >= 0);
        Assert.Equal(token, new PurchaseTokenProtector(_options).Open(purchase.VerificationHandleEncrypted!));

        var columns = await _db.Database.SqlQueryRaw<string>(
            "SELECT t.name + '.' + c.name + ':' + ty.name AS [Value] FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id JOIN sys.types ty ON ty.user_type_id = c.user_type_id WHERE s.name = 'billing' AND (c.name LIKE '%Token%' OR c.name LIKE '%Handle%') AND c.name NOT LIKE '%AtUtc'")
            .ToListAsync();
        // Hashes (binary) and sealed handles (varbinary): never a character column that could hold a token.
        Assert.All(columns, column => Assert.Contains("binary", column, StringComparison.Ordinal));
        Assert.Contains(columns, column => column.StartsWith("StorePurchases.VerificationHandleEncrypted", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ATamperedSealedTokenInTheDatabase_IsDetectedAtReconcile_NeverUsed()
    {
        var token = NewToken("tamper");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30), ackPending: false));
        await Service(_db).VerifyAsync(_userA, token);
        var hash = new PurchaseTokenProtector(_options).Hash(token);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE billing.StorePurchases SET VerificationHandleEncrypted = CAST(REPLICATE(0x41, 60) AS varbinary(2048)) WHERE ExternalKeyHash = {hash}");

        var purchaseId = (await PurchaseOfAsync(token))!.Id;
        var outcome = await Processor(NewContext()).ReconcilePurchaseAsync(purchaseId);

        Assert.Equal(ProcessOutcome.RetryScheduled, outcome);
    }

    [Fact]
    public async Task VerifyPending_GrantsNoEntitlement_AndIsNotAcknowledged()
    {
        var token = NewToken("pending");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Pending, KeyOf(_userA), null));

        var result = await Service(_db).VerifyAsync(_userA, token);

        Assert.Equal(GoogleVerifyOutcome.Pending, result.Outcome);
        Assert.Empty(_google.Acknowledged);
        var entitlement = await Entitlements(NewContext()).GetForUserAsync(_userA);
        Assert.Equal(EntitlementStatus.Expired, entitlement.Status);
        Assert.Equal(EndedTrial.EndsAtUtc, entitlement.AccessFrozenAtUtc);
    }

    [Fact]
    public async Task ReplayBySameUser_ConvergesAndAcknowledgesOnce()
    {
        var token = NewToken("replay");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));

        await Service(_db).VerifyAsync(_userA, token);
        await Service(NewContext()).VerifyAsync(_userA, token);

        Assert.Equal(1, await _db.StorePurchases.AsNoTracking().CountAsync(purchase => purchase.UserId == _userA && purchase.ProductId == "juple_monthly" && _tokens.Contains(token)));
        Assert.Single(_google.Acknowledged);
    }

    [Fact]
    public async Task EightConcurrentVerifies_ConvergeOnOnePurchase()
    {
        var token = NewToken("race");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            await using var db = NewContext();
            return await Service(db).VerifyAsync(_userA, token);
        })));

        Assert.All(results, result => Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome));
        var hash = new PurchaseTokenProtector(_options).Hash(token);
        Assert.Equal(1, await _db.StorePurchases.AsNoTracking().CountAsync(purchase => purchase.ExternalKeyHash == hash));
        Assert.Equal(_userA, (await PurchaseOfAsync(token))!.UserId);
        Assert.NotEmpty(_google.Acknowledged);
    }

    [Fact]
    public async Task TheSameTokenFromASecondAccount_IsAConflict_AndNeverTransfers()
    {
        var token = NewToken("owner");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        await Service(_db).VerifyAsync(_userA, token);

        await Assert.ThrowsAsync<PurchaseBelongsToAnotherAccountException>(() => Service(NewContext()).VerifyAsync(_userB, token));

        Assert.Equal(_userA, (await PurchaseOfAsync(token))!.UserId);
        Assert.Equal(EntitlementStatus.Expired, (await Entitlements(NewContext()).GetForUserAsync(_userB)).Status);
    }

    [Fact]
    public async Task WrongAccountIdOrProduct_IsRefused_NothingStored()
    {
        var wrongAccount = NewToken("wrong-account");
        var wrongProduct = NewToken("wrong-product");
        _google.Set(wrongAccount, Snapshot(GoogleSubscriptionState.Active, "an-id-no-account-has", Now.AddDays(30)));
        _google.Set(wrongProduct, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30), productId: "other_product"));

        await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => Service(_db).VerifyAsync(_userA, wrongAccount));
        await Assert.ThrowsAsync<PurchaseNotAllowedException>(() => Service(_db).VerifyAsync(_userA, wrongProduct));

        Assert.Null(await PurchaseOfAsync(wrongAccount));
        Assert.Null(await PurchaseOfAsync(wrongProduct));
        Assert.Empty(_google.Acknowledged);
    }

    [Fact]
    public async Task AnAcknowledgementFailure_KeepsThePurchaseVerified_AndTheSweepAcknowledgesLater()
    {
        var token = NewToken("ack");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        _google.AcknowledgeFailure = new GooglePlayUnavailableException("503");

        var result = await Service(_db).VerifyAsync(_userA, token);

        Assert.Equal(GoogleVerifyOutcome.Verified, result.Outcome);
        Assert.False(result.Acknowledged);
        Assert.True((await PurchaseOfAsync(token))!.AcknowledgementPending);

        _google.AcknowledgeFailure = null;
        var purchaseId = (await PurchaseOfAsync(token))!.Id;
        await Processor(NewContext()).ReconcilePurchaseAsync(purchaseId);

        Assert.False((await PurchaseOfAsync(token))!.AcknowledgementPending);
        Assert.Single(_google.Acknowledged);
    }

    // ---------------------------------------------------------------- account deletion

    [Fact]
    public async Task DeletingTheAccount_DetachesThePurchase_KeepsOnlyItsIdentity_AndARecreatedAccountCanRestoreIt()
    {
        var token = NewToken("detach");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30), ackPending: false));
        await Service(_db).VerifyAsync(_userA, token);
        Assert.True(await _db.GoogleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == _userA));

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_userA, $"test/{_userA}/", Now);

        var purchase = (await PurchaseOfAsync(token))!;
        Assert.Null(purchase.UserId);
        Assert.Equal(Now, purchase.DetachedAtUtc);
        Assert.Equal(StorePurchaseState.Active, purchase.State);
        Assert.NotEmpty(purchase.VerificationHandleEncrypted);
        Assert.False(await _db.GoogleAccountLinks.AsNoTracking().AnyAsync(link => link.UserId == _userA));
        // No profile, email or Juple ID anywhere on the purchase row.
        var columns = await _db.Database.SqlQueryRaw<string>(
            "SELECT c.name AS [Value] FROM sys.columns c WHERE c.object_id = OBJECT_ID('billing.StorePurchases')").ToListAsync();
        Assert.DoesNotContain(columns, column => column.Contains("Email", StringComparison.OrdinalIgnoreCase) || column.Contains("PublicCode", StringComparison.OrdinalIgnoreCase) || column.Contains("Name", StringComparison.OrdinalIgnoreCase) && column != "ProductId");

        // Account B (a re-created account) presents the token: the original account is gone, so a verified restore may take it over.
        var restored = await Service(NewContext()).VerifyAsync(_userB, token);
        Assert.Equal(GoogleVerifyOutcome.Verified, restored.Outcome);
        Assert.Equal(_userB, (await PurchaseOfAsync(token))!.UserId);
        Assert.Null((await PurchaseOfAsync(token))!.DetachedAtUtc);
    }

    // ---------------------------------------------------------------- notifications

    [Fact]
    public async Task EightConcurrentDeliveriesOfOneMessage_AreOneEvent()
    {
        var token = NewToken("dup");
        var messageId = $"{_run}-dup";

        var results = await Task.WhenAll(Enumerable.Range(0, 8).Select(_ => Task.Run(async () =>
        {
            await using var db = NewContext();
            return await Processor(db).IngestAsync(messageId, new GoogleNotification("subscription:4", token, Now));
        })));

        Assert.Single(results.Select(result => result.Id).Distinct());
        Assert.Equal(1, results.Count(result => result.IsNew));
        Assert.Equal(1, await _db.StoreEvents.AsNoTracking().CountAsync(entry => entry.ExternalEventId == messageId));
    }

    [Fact]
    public async Task TheEventIsInSqlBeforeAnyDispatch_AndASweepRecoversALostWakeUp_WithAFreshGoogleFetch()
    {
        var token = NewToken("outbox");
        await LinkAsync(_userA);
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        var inserted = await Processor(_db, new RecordingSignal { Succeeds = false }).IngestAsync($"{_run}-outbox", new GoogleNotification("subscription:4", token, Now));

        var stored = await _db.StoreEvents.AsNoTracking().SingleAsync(entry => entry.Id == inserted.Id);
        Assert.Null(stored.DispatchedAtUtc);
        Assert.Equal(StoreEventResult.Pending, stored.Result);
        Assert.NotNull(stored.EncryptedToken);

        var summary = await Processor(NewContext()).SweepAsync(50, 0);

        Assert.True(summary.EventsProcessed >= 1);
        var processed = await _db.StoreEvents.AsNoTracking().SingleAsync(entry => entry.Id == inserted.Id);
        Assert.Equal(StoreEventResult.Processed, processed.Result);
        Assert.Null(processed.EncryptedToken);
        Assert.Equal(_userA, (await PurchaseOfAsync(token))!.UserId);
    }

    [Fact]
    public async Task OutOfOrderNotifications_EndOnGoogleCurrentTruth()
    {
        var token = NewToken("order");
        var key = KeyOf(_userA);
        await LinkAsync(_userA);
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, key, Now.AddDays(30), ackPending: false));
        var first = await Processor(_db).IngestAsync($"{_run}-order-1", new GoogleNotification("subscription:2", token, Now));
        var second = await Processor(_db).IngestAsync($"{_run}-order-2", new GoogleNotification("subscription:13", token, Now.AddDays(-1)));

        await Processor(NewContext()).ProcessEventAsync(first.Id);
        _google.Set(token, Snapshot(GoogleSubscriptionState.OnHold, key, Now.AddDays(-1), ackPending: false));
        await Processor(NewContext()).ProcessEventAsync(second.Id);

        var purchase = (await PurchaseOfAsync(token))!;
        Assert.Equal(StorePurchaseState.OnHold, purchase.State);
        Assert.Equal(EntitlementReason.BillingIssue, purchase.Reason);
    }

    [Fact]
    public async Task ANotificationThatCannotBeTiedToAnAccount_IsNeverGuessed()
    {
        var token = NewToken("unlinked");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, "an-id-no-account-has", Now.AddDays(30)));
        var inserted = await Processor(_db).IngestAsync($"{_run}-unlinked", new GoogleNotification("subscription:4", token, Now));

        var outcome = await Processor(NewContext()).ProcessEventAsync(inserted.Id);

        Assert.Equal(ProcessOutcome.Unlinked, outcome);
        Assert.Null(await PurchaseOfAsync(token));
        Assert.Equal(StoreEventResult.Unlinked, (await _db.StoreEvents.AsNoTracking().SingleAsync(entry => entry.Id == inserted.Id)).Result);
        Assert.Empty(_google.Acknowledged);
    }

    [Fact]
    public async Task ADuplicateWorkerDelivery_ProcessesTheEventOnce()
    {
        var token = NewToken("worker");
        await LinkAsync(_userA);
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        var inserted = await Processor(_db).IngestAsync($"{_run}-worker", new GoogleNotification("subscription:4", token, Now));

        var outcomes = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(async () =>
        {
            await using var db = NewContext();
            return await Processor(db).ProcessEventAsync(inserted.Id);
        })));

        Assert.Equal(1, outcomes.Count(outcome => outcome == ProcessOutcome.Processed));
        Assert.All(outcomes.Where(outcome => outcome != ProcessOutcome.Processed), outcome => Assert.Equal(ProcessOutcome.NotTaken, outcome));
    }

    [Fact]
    public async Task TwoSweepsNeverClaimTheSameDuePurchase()
    {
        var token = NewToken("claim");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30), ackPending: false));
        await Service(_db).VerifyAsync(_userA, token);
        var later = Now.AddDays(2);

        var claims = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Task.Run(async () =>
        {
            await using var db = NewContext();
            return await new GoogleBillingStore(db).ClaimDuePurchaseIdsAsync(later, TimeSpan.FromMinutes(10), 500);
        })));

        var ids = claims.SelectMany(list => list).ToList();
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Contains((await PurchaseOfAsync(token))!.Id, ids);
    }

    // ---------------------------------------------------------------- effective entitlement over real purchases

    [Fact]
    public async Task EntitlementOverRealPurchases_CanceledOnHoldAndExpired()
    {
        var token = NewToken("states");
        var key = KeyOf(_userA);
        _google.Set(token, Snapshot(GoogleSubscriptionState.Canceled, key, Now.AddDays(9), ackPending: false));
        await Service(_db).VerifyAsync(_userA, token);
        var canceled = await Entitlements(NewContext()).GetForUserAsync(_userA);
        Assert.Equal(EntitlementStatus.Active, canceled.Status);
        Assert.Equal(EntitlementReason.Cancelled, canceled.Reason);

        _time.Now = Now.AddDays(10);
        _google.Set(token, Snapshot(GoogleSubscriptionState.OnHold, key, Now.AddDays(9), ackPending: false));
        await Service(NewContext()).VerifyAsync(_userA, token);
        var hold = await Entitlements(NewContext()).GetForUserAsync(_userA);
        Assert.Equal(EntitlementStatus.Expired, hold.Status);
        Assert.False(hold.CanWrite);
        Assert.Equal(Now.AddDays(9), hold.AccessFrozenAtUtc);
        Assert.Equal(EntitlementReason.BillingIssue, hold.Reason);

        // Later it is simply expired: the freeze instant does not move with the clock.
        _time.Now = Now.AddDays(100);
        _google.Set(token, Snapshot(GoogleSubscriptionState.Expired, key, Now.AddDays(9), ackPending: false));
        await Service(NewContext()).VerifyAsync(_userA, token);
        var expired = await Entitlements(NewContext()).GetForUserAsync(_userA);
        Assert.Equal(hold.AccessFrozenAtUtc, expired.AccessFrozenAtUtc);
    }

    [Fact]
    public async Task WhileTheProgramIsNotLaunched_APurchaseChangesNothingVisible()
    {
        var token = NewToken("program-off");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        await Service(_db).VerifyAsync(_userA, token);
        var off = new BillingOptions { ProgramEnabled = false };

        var entitlement = await new EntitlementService(off, new EntitlementStore(NewContext()), new TrialIdentityHasher(off), _time).GetForUserAsync(_userA);

        Assert.False(entitlement.ProgramEnabled);
        Assert.Null(entitlement.Status);
        Assert.True(entitlement.CanWrite);
    }

    [Fact]
    public async Task StoreOwnership_OverRealPurchases_IsOwnedWhileCurrent_AndNeverLeaksAcrossAccounts()
    {
        var token = NewToken("ownership");
        _google.Set(token, Snapshot(GoogleSubscriptionState.Active, KeyOf(_userA), Now.AddDays(30)));
        await Service(_db).VerifyAsync(_userA, token);

        var mine = StoreSubscriptionOwnership.From(await new EntitlementStore(NewContext()).GetOwnedPurchasesAsync(_userA), Now);
        var others = StoreSubscriptionOwnership.From(await new EntitlementStore(NewContext()).GetOwnedPurchasesAsync(_userB), Now);
        var afterEnd = StoreSubscriptionOwnership.From(await new EntitlementStore(NewContext()).GetOwnedPurchasesAsync(_userA), Now.AddDays(31));

        Assert.Equal(StoreSubscriptionState.Active, mine.State);
        Assert.Equal("juple_monthly", mine.ProductId);
        Assert.Equal(Now.AddDays(30), mine.CurrentPeriodEndsAtUtc);
        Assert.Equal(StoreSubscriptionState.None, others.State);
        Assert.Equal(StoreSubscriptionState.None, afterEnd.State);
    }

    // ---------------------------------------------------------------- migration

    [Fact]
    public async Task TheMigration_FromTheSubscriptionFoundation_AddsOnlyTheGoogleBillingTables_AndKeepsTheRollingDefault()
    {
        var builder = new SqlConnectionStringBuilder(_connectionString);
        builder.InitialCatalog = $"{builder.InitialCatalog}_GoogleBilling_{Guid.NewGuid():N}";
        await using var db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(builder.ConnectionString).Options);
        try
        {
            var migrator = db.GetService<IMigrator>();
            await migrator.MigrateAsync("20261007125101_AddSubscriptionFoundation");
            Assert.Equal(0, (await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS [Value] FROM sys.tables WHERE name IN ('StorePurchases', 'StoreEvents', 'GoogleAccountLinks')").ToListAsync()).Single());

            await migrator.MigrateAsync();

            var indexes = await db.Database.SqlQuery<string>(
                $"SELECT i.name + '|' + CAST(i.is_unique AS varchar(1)) + '|' + ISNULL(i.filter_definition, '') AS [Value] FROM sys.indexes i JOIN sys.tables t ON t.object_id = i.object_id JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'billing' AND i.name IS NOT NULL AND i.is_primary_key = 0").ToListAsync();
            Assert.Contains("UX_StorePurchases_Source_ExternalKeyHash|1|", indexes);
            Assert.Contains("UX_StoreEvents_Source_ExternalEventId|1|", indexes);
            Assert.Contains("UX_GoogleAccountLinks_UserId|1|", indexes);
            Assert.Contains("UX_GoogleAccountLinks_AccountKey|1|", indexes);
            Assert.Contains("IX_StoreEvents_Unprocessed_NextAttemptAtUtc|0|([ProcessedAtUtc] IS NULL)", indexes);

            var fks = await db.Database.SqlQuery<string>(
                $"SELECT fk.name AS [Value] FROM sys.foreign_keys fk JOIN sys.tables t ON t.object_id = fk.parent_object_id JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE s.name = 'billing'").ToListAsync();
            Assert.Contains("FK_StorePurchases_Users_UserId", fks);
            Assert.Contains("FK_GoogleAccountLinks_Users_UserId", fks);
            Assert.DoesNotContain(fks, name => name.Contains("TrialLedger", StringComparison.Ordinal));

            Assert.Equal(1, (await db.Database.SqlQuery<int>($"SELECT CAST(is_nullable AS int) AS [Value] FROM sys.columns WHERE object_id = OBJECT_ID('billing.StorePurchases') AND name = 'UserId'").ToListAsync()).Single());
            Assert.Equal(0, (await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS [Value] FROM sys.columns WHERE object_id IN (OBJECT_ID('billing.StorePurchases'), OBJECT_ID('billing.StoreEvents')) AND name IN ('PurchaseToken', 'Token', 'RawBody', 'Payload', 'Authorization')").ToListAsync()).Single());
            Assert.Equal(0, (await db.Database.SqlQuery<int>($"SELECT (SELECT COUNT(*) FROM billing.StorePurchases) + (SELECT COUNT(*) FROM billing.StoreEvents) + (SELECT COUNT(*) FROM billing.GoogleAccountLinks) AS [Value]").ToListAsync()).Single());
            Assert.Equal(1, (await db.Database.SqlQuery<int>($"SELECT COUNT(*) AS [Value] FROM sys.default_constraints WHERE name = 'DF_CollectionItems_VisibleSinceUtc_RollingCompat'").ToListAsync()).Single());
        }
        finally
        {
            await db.Database.EnsureDeletedAsync();
        }
    }
}
