using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.UnitTests.Billing.GooglePlay;

public sealed class StubTime(DateTimeOffset now) : TimeProvider
{
    public DateTimeOffset Now { get; set; } = now;

    public override DateTimeOffset GetUtcNow() => Now;
}

/// <summary>A scriptable Google Play: per token a snapshot or a failure. Records every call; never touches the network.</summary>
public sealed class FakeGooglePlayClient : IGooglePlayClient
{
    private readonly Dictionary<string, GoogleSubscriptionSnapshot> _snapshots = [];
    private readonly Dictionary<string, Exception> _getFailures = [];

    public int GetCalls { get; private set; }

    public List<string> Acknowledged { get; } = [];

    public Exception? AcknowledgeFailure { get; set; }

    /// <summary>If set, an acknowledgement that fails still flips the purchase to acknowledged (the device finished it first).</summary>
    public bool AcknowledgeFailureButNowAcknowledged { get; set; }

    public void Set(string token, GoogleSubscriptionSnapshot snapshot) => _snapshots[token] = snapshot;

    public void Fail(string token, Exception exception) => _getFailures[token] = exception;

    public void ClearFailure(string token) => _getFailures.Remove(token);

    public Task<GoogleSubscriptionSnapshot> GetSubscriptionAsync(string packageName, string purchaseToken, string expectedProductId, CancellationToken cancellationToken = default)
    {
        GetCalls++;
        if (_getFailures.TryGetValue(purchaseToken, out var failure))
        {
            throw failure;
        }

        return _snapshots.TryGetValue(purchaseToken, out var snapshot)
            ? Task.FromResult(snapshot)
            : throw new GooglePlayPurchaseNotFoundException();
    }

    public Task AcknowledgeAsync(string packageName, string productId, string purchaseToken, CancellationToken cancellationToken = default)
    {
        if (AcknowledgeFailure is { } failure)
        {
            if (AcknowledgeFailureButNowAcknowledged && _snapshots.TryGetValue(purchaseToken, out var current))
            {
                _snapshots[purchaseToken] = current with { AcknowledgementPending = false };
            }

            throw failure;
        }

        Acknowledged.Add(purchaseToken);
        if (_snapshots.TryGetValue(purchaseToken, out var snapshot))
        {
            _snapshots[purchaseToken] = snapshot with { AcknowledgementPending = false };
        }

        return Task.CompletedTask;
    }
}

public sealed class FakeTelemetry : IBillingTelemetry
{
    public List<string> Entries { get; } = [];

    public void VerifyCompleted(long purchaseId, GoogleVerifyOutcome outcome, StorePurchaseState state) => Entries.Add($"verify:{outcome}:{state}");

    public void VerifyRejected(string reason) => Entries.Add($"rejected:{reason}");

    public void PurchaseConflict(string operation) => Entries.Add($"conflict:{operation}");

    public void GoogleCallFailed(string operation, string errorType) => Entries.Add($"googleFailed:{operation}:{errorType}");

    public void AcknowledgeFailed(long purchaseId) => Entries.Add("ackFailed");

    public void EventIngested(long eventId, bool isNew, string eventType) => Entries.Add($"ingested:{isNew}:{eventType}");

    public void EventProcessed(long eventId, StoreEventResult result) => Entries.Add($"processed:{result}");

    public void EventRetryScheduled(long eventId, int attempt, string errorCode) => Entries.Add($"retry:{attempt}:{errorCode}");

    public void PurchaseReconciled(long purchaseId, StorePurchaseState from, StorePurchaseState to) => Entries.Add($"reconciled:{from}->{to}");
}

public sealed class FakeSignal : IBillingEventSignal
{
    public bool Succeeds { get; set; } = true;

    public List<long> Signalled { get; } = [];

    public Task<bool> TrySignalAsync(long eventId, CancellationToken cancellationToken = default)
    {
        if (!Succeeds)
        {
            return Task.FromResult(false);
        }

        Signalled.Add(eventId);
        return Task.FromResult(true);
    }
}

/// <summary>An in-memory IGoogleBillingStore that applies the SAME domain rules as the SQL one (ownership, claim of a detached purchase, stable lapse end).</summary>
public sealed class FakeGoogleBillingStore : IGoogleBillingStore
{
    private long _nextId = 1;
    private readonly Dictionary<long, StorePurchase> _purchases = [];
    private readonly Dictionary<long, StoreEvent> _events = [];
    private readonly Dictionary<string, long> _links = [];
    private readonly HashSet<long> _usersWithLink = [];

    public Dictionary<long, StorePurchase> Purchases => _purchases;

    public Dictionary<long, StoreEvent> Events => _events;

    public void AddLink(long userId, string key)
    {
        _links[key] = userId;
        _usersWithLink.Add(userId);
    }

    public void RemoveLinkOf(long userId)
    {
        foreach (var key in _links.Where(pair => pair.Value == userId).Select(pair => pair.Key).ToList())
        {
            _links.Remove(key);
        }

        _usersWithLink.Remove(userId);
    }

    public Task EnsureAccountLinkAsync(long userId, string accountKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (_usersWithLink.Add(userId))
        {
            _links[accountKey] = userId;
        }

        return Task.CompletedTask;
    }

    public Task<long?> FindUserIdByAccountKeyAsync(string accountKey, CancellationToken cancellationToken = default) =>
        Task.FromResult<long?>(_links.TryGetValue(accountKey, out var user) ? user : null);

    public Task<StorePurchaseRecord?> FindPurchaseAsync(byte[] externalKeyHash, CancellationToken cancellationToken = default) =>
        Task.FromResult(_purchases.Where(pair => pair.Value.ExternalKeyHash.AsSpan().SequenceEqual(externalKeyHash)).Select(pair => ToRecord(pair.Key, pair.Value)).FirstOrDefault());

    public Task<StorePurchaseRecord?> FindPurchaseAsync(long purchaseId, CancellationToken cancellationToken = default) =>
        Task.FromResult(_purchases.TryGetValue(purchaseId, out var purchase) ? ToRecord(purchaseId, purchase) : null);

    public Task<IReadOnlyList<StorePurchaseRecord>> ListPurchasesForUserAsync(long userId, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<StorePurchaseRecord>>(_purchases.Where(pair => pair.Value.UserId == userId).Select(pair => ToRecord(pair.Key, pair.Value)).ToList());

    public Task<StorePurchaseRecord> UpsertPurchaseAsync(UpsertPurchaseCommand command, CancellationToken cancellationToken = default)
    {
        var existing = _purchases.FirstOrDefault(pair => pair.Value.ExternalKeyHash.AsSpan().SequenceEqual(command.ExternalKeyHash));
        StorePurchase purchase;
        long id;
        if (existing.Value is null)
        {
            id = _nextId++;
            purchase = new StorePurchase(command.UserId, StoreSource.GooglePlay, command.ProductId, command.ExternalKeyHash, command.EncryptedToken, command.NowUtc);
            _purchases[id] = purchase;
        }
        else
        {
            (id, purchase) = (existing.Key, existing.Value);
            if (command.UserId is { } requester && purchase.UserId != requester)
            {
                if (purchase.UserId is null && command.AllowClaimDetached)
                {
                    purchase.LinkTo(requester, command.NowUtc);
                }
                else
                {
                    throw new StorePurchaseOwnershipConflictException();
                }
            }
        }

        purchase.ApplyVerified(command.Normalized, command.BasePlanId, command.PeriodStartUtc, command.NowUtc);
        return Task.FromResult(ToRecord(id, purchase));
    }

    public Task MarkAcknowledgedAsync(long purchaseId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        _purchases[purchaseId].MarkAcknowledged(nowUtc);
        return Task.CompletedTask;
    }

    public Task<StoreEventInsertResult> TryInsertEventAsync(StoreEvent storeEvent, CancellationToken cancellationToken = default)
    {
        var existing = _events.FirstOrDefault(pair => pair.Value.ExternalEventId == storeEvent.ExternalEventId);
        if (existing.Value is not null)
        {
            return Task.FromResult(new StoreEventInsertResult(existing.Key, IsNew: false));
        }

        var id = _nextId++;
        _events[id] = storeEvent;
        return Task.FromResult(new StoreEventInsertResult(id, IsNew: true));
    }

    public Task MarkEventDispatchedAsync(long eventId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        _events[eventId].MarkDispatched(nowUtc);
        return Task.CompletedTask;
    }

    public Task<StoreEventWork?> ClaimEventAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
    {
        if (!_events.TryGetValue(eventId, out var storeEvent) || storeEvent.ProcessedAtUtc is not null || storeEvent.NextAttemptAtUtc > nowUtc)
        {
            return Task.FromResult<StoreEventWork?>(null);
        }

        storeEvent.Fail("leased", nowUtc + lease, permanent: false, nowUtc);
        // A lease is not a failure: undo the attempt it counted.
        typeof(StoreEvent).GetProperty(nameof(StoreEvent.AttemptCount))!.SetValue(storeEvent, storeEvent.AttemptCount - 1);
        return Task.FromResult<StoreEventWork?>(new StoreEventWork(eventId, storeEvent.EventType, storeEvent.TokenHash, storeEvent.EncryptedToken, storeEvent.AttemptCount));
    }

    public Task<IReadOnlyList<long>> ListDueEventIdsAsync(DateTimeOffset nowUtc, int limit, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<long>>(_events.Where(pair => pair.Value.ProcessedAtUtc is null && pair.Value.NextAttemptAtUtc <= nowUtc).Select(pair => pair.Key).Take(limit).ToList());

    public Task CompleteEventAsync(long eventId, StoreEventResult result, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        _events[eventId].Complete(result, nowUtc);
        return Task.CompletedTask;
    }

    public Task FailEventAsync(long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool permanent, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        _events[eventId].Fail(errorCode, nextAttemptAtUtc, permanent, nowUtc);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<long>> ClaimDuePurchaseIdsAsync(DateTimeOffset nowUtc, TimeSpan lease, int limit, CancellationToken cancellationToken = default) =>
        Task.FromResult<IReadOnlyList<long>>(_purchases.Where(pair => pair.Value.NextReconcileAtUtc <= nowUtc).Select(pair => pair.Key).Take(limit).ToList());

    private static StorePurchaseRecord ToRecord(long id, StorePurchase purchase) => new(
        id, purchase.UserId, purchase.ProductId, purchase.State, purchase.Reason, purchase.AccessEndsAtUtc, purchase.VerificationHandleEncrypted, purchase.AcknowledgementPending);
}

public static class GoogleTestData
{
    public const string ProductId = "juple_monthly";
    public const string BasePlanId = "monthly";
    public static readonly string Key32 = Convert.ToBase64String(Enumerable.Range(1, 32).Select(value => (byte)value).ToArray());
    public static readonly string Key32B = Convert.ToBase64String(Enumerable.Range(101, 32).Select(value => (byte)value).ToArray());
    public static readonly string Key32C = Convert.ToBase64String(Enumerable.Range(201, 32).Select(value => (byte)value).ToArray());

    public static BillingOptions Options(bool enabled = true) => new()
    {
        TrialIdentityHashKey = Key32C,
        Google = new GoogleBillingOptions
        {
            Enabled = enabled,
            ProductId = ProductId,
            BasePlanId = BasePlanId,
            ServiceAccountCredentialJson = "{}",
            AccountHashKey = Key32,
            PurchaseTokenEncryptionKey = Key32B,
            PubSub = new GooglePubSubOptions { Audience = "https://api.example.test/rtdn", PushServiceAccountEmail = "push@example.iam.gserviceaccount.com" },
        },
    };

    public static GoogleSubscriptionSnapshot Snapshot(
        GoogleSubscriptionState state = GoogleSubscriptionState.Active,
        string? obfuscatedAccountId = null,
        DateTimeOffset? expiry = null,
        bool ackPending = true,
        string productId = ProductId,
        string? basePlanId = BasePlanId,
        GooglePlanType plan = GooglePlanType.AutoRenewing,
        GoogleCancelSource cancel = GoogleCancelSource.None,
        string? linkedPurchaseToken = null) => new(
        state, productId, basePlanId, plan, StartTimeUtc: null, expiry, AutoRenewing: true, ackPending, obfuscatedAccountId, linkedPurchaseToken, cancel, IsTestPurchase: false);
}
