using Juple.Domain.Billing;

namespace Juple.Application.Billing.GooglePlay;

/// <summary>A parsed Google RTDN (DeveloperNotification) reduced to what reconciliation needs. The body itself is never kept.</summary>
public sealed record GoogleNotification(string EventType, string? PurchaseToken, DateTimeOffset? EventTimeUtc);

public enum ProcessOutcome
{
    /// <summary>Not taken: already processed, not due yet, or held by another processor.</summary>
    NotTaken,

    Processed,
    Unlinked,
    Ignored,

    /// <summary>A transient failure: SQL owns the retry (back-off).</summary>
    RetryScheduled,
    FailedPermanent,
}

public sealed record SweepSummary(int EventsProcessed, int PurchasesReconciled, int Failures);

public interface IGoogleBillingProcessor
{
    /// <summary>Durably records a notification (idempotent on the Pub/Sub message id) and wakes the worker - best effort.</summary>
    Task<StoreEventInsertResult> IngestAsync(string messageId, GoogleNotification notification, CancellationToken cancellationToken = default);

    Task<ProcessOutcome> ProcessEventAsync(long eventId, CancellationToken cancellationToken = default);

    Task<ProcessOutcome> ReconcilePurchaseAsync(long purchaseId, CancellationToken cancellationToken = default);

    /// <summary>One bounded pass: events not yet processed (including any whose wake-up was lost) and purchases whose check is due.</summary>
    Task<SweepSummary> SweepAsync(int eventLimit, int purchaseLimit, CancellationToken cancellationToken = default);
}

/// <summary>
/// The asynchronous half: Google Real-time Developer Notifications and the periodic reconciliation. A notification is only ever a
/// REASON TO ASK GOOGLE - its type is never applied. Processing fetches the authoritative state and then applies it to the purchase,
/// so duplicates, replays and out-of-order deliveries all converge on Google's current truth. A purchase is tied to an account only
/// by evidence: the token already linked, the opaque account id Juple gave Google, or the purchase it replaces; anything else is
/// kept as Unlinked and never attached to anyone.
/// </summary>
public sealed class GoogleBillingProcessor(
    BillingOptions options,
    IGooglePlayClient google,
    IGoogleBillingStore store,
    IPurchaseTokenProtector tokens,
    IBillingEventSignal signal,
    IBillingTelemetry telemetry,
    TimeProvider timeProvider) : IGoogleBillingProcessor
{
    private static readonly TimeSpan EventLease = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PurchaseLease = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromHours(6);
    private const int MaxAttempts = 30;

    public async Task<StoreEventInsertResult> IngestAsync(string messageId, GoogleNotification notification, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var token = notification.PurchaseToken;
        var storeEvent = new StoreEvent(
            StoreSource.GooglePlay,
            messageId,
            notification.EventType,
            token is null ? null : tokens.Hash(token),
            token is null ? null : tokens.Seal(token),
            nowUtc);

        // 1. DURABLE FIRST: the event is committed before anything is signalled. A duplicate or concurrent delivery of the same
        //    message id is the same event (unique index), never a second one.
        var inserted = await store.TryInsertEventAsync(storeEvent, cancellationToken);
        telemetry.EventIngested(inserted.Id, inserted.IsNew, notification.EventType);

        // 2. Then wake the worker - best effort. A failure here loses nothing: the event is in SQL, undispatched, and the sweep takes it.
        if (inserted.IsNew && await signal.TrySignalAsync(inserted.Id, cancellationToken))
        {
            await store.MarkEventDispatchedAsync(inserted.Id, timeProvider.GetUtcNow(), cancellationToken);
        }

        return inserted;
    }

    public async Task<ProcessOutcome> ProcessEventAsync(long eventId, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var work = await store.ClaimEventAsync(eventId, nowUtc, EventLease, cancellationToken);
        if (work is null)
        {
            return ProcessOutcome.NotTaken;
        }

        try
        {
            var result = await ReconcileEventAsync(work, cancellationToken);
            await store.CompleteEventAsync(eventId, result, timeProvider.GetUtcNow(), cancellationToken);
            telemetry.EventProcessed(eventId, result);
            return result switch
            {
                StoreEventResult.Unlinked => ProcessOutcome.Unlinked,
                StoreEventResult.Ignored => ProcessOutcome.Ignored,
                _ => ProcessOutcome.Processed,
            };
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException or PurchaseTokenTamperedException or StorePurchaseOwnershipConflictException)
        {
            var attempt = work.AttemptCount + 1;
            var permanent = exception is PurchaseTokenTamperedException or StorePurchaseOwnershipConflictException || attempt >= MaxAttempts;
            var code = exception.GetType().Name;
            await store.FailEventAsync(eventId, code, nowUtc + Backoff(attempt), permanent, timeProvider.GetUtcNow(), cancellationToken);
            telemetry.EventRetryScheduled(eventId, attempt, code);
            return permanent ? ProcessOutcome.FailedPermanent : ProcessOutcome.RetryScheduled;
        }
    }

    public async Task<ProcessOutcome> ReconcilePurchaseAsync(long purchaseId, CancellationToken cancellationToken = default)
    {
        var purchase = await store.FindPurchaseAsync(purchaseId, cancellationToken);
        if (purchase is null)
        {
            return ProcessOutcome.NotTaken;
        }

        if (purchase.VerificationHandleEncrypted is not { } sealedHandle)
        {
            // The retention cleanup removed the sealed token of a purchase that ended long ago: nothing is left to re-check.
            return ProcessOutcome.NotTaken;
        }

        string? token = null;
        try
        {
            token = tokens.Open(sealedHandle);
            await ApplyFetchedAsync(token, purchase.UserId, purchase, cancellationToken);
            return ProcessOutcome.Processed;
        }
        catch (GooglePlayPurchaseNotFoundException) when (token is not null)
        {
            // Google forgot the token (it is only kept for a while after expiry): the purchase simply ended.
            await store.UpsertPurchaseAsync(Lapsed(purchase, token), cancellationToken);
            return ProcessOutcome.Processed;
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException or PurchaseTokenTamperedException)
        {
            telemetry.GoogleCallFailed("reconcile", exception.GetType().Name);
            return ProcessOutcome.RetryScheduled;
        }
    }

    public async Task<SweepSummary> SweepAsync(int eventLimit, int purchaseLimit, CancellationToken cancellationToken = default)
    {
        var events = 0;
        var purchases = 0;
        var failures = 0;

        foreach (var id in await store.ListDueEventIdsAsync(timeProvider.GetUtcNow(), eventLimit, cancellationToken))
        {
            var outcome = await ProcessEventAsync(id, cancellationToken);
            events += outcome is ProcessOutcome.Processed or ProcessOutcome.Unlinked or ProcessOutcome.Ignored ? 1 : 0;
            failures += outcome is ProcessOutcome.RetryScheduled or ProcessOutcome.FailedPermanent ? 1 : 0;
        }

        foreach (var id in await store.ClaimDuePurchaseIdsAsync(timeProvider.GetUtcNow(), PurchaseLease, purchaseLimit, cancellationToken))
        {
            var outcome = await ReconcilePurchaseAsync(id, cancellationToken);
            purchases += outcome == ProcessOutcome.Processed ? 1 : 0;
            failures += outcome == ProcessOutcome.RetryScheduled ? 1 : 0;
        }

        return new SweepSummary(events, purchases, failures);
    }

    private async Task<StoreEventResult> ReconcileEventAsync(StoreEventWork work, CancellationToken cancellationToken)
    {
        if (work.EncryptedToken is null || work.TokenHash is null)
        {
            // test notifications and other kinds carry no purchase to reconcile.
            return StoreEventResult.Ignored;
        }

        var token = tokens.Open(work.EncryptedToken);
        var existing = await store.FindPurchaseAsync(work.TokenHash, cancellationToken);
        try
        {
            if (existing is not null)
            {
                await ApplyFetchedAsync(token, existing.UserId, existing, cancellationToken);
                return StoreEventResult.Processed;
            }

            return await ResolveNewPurchaseAsync(token, work.TokenHash, cancellationToken);
        }
        catch (GooglePlayPurchaseNotFoundException)
        {
            if (existing is not null)
            {
                await store.UpsertPurchaseAsync(Lapsed(existing, token), cancellationToken);
                return StoreEventResult.Processed;
            }

            // A token Google does not know and Juple never linked (a test or a stray message): nothing to reconcile.
            return StoreEventResult.Ignored;
        }
    }

    /// <summary>A purchase Juple has not recorded yet (the app never reached /verify, or it is a re-subscription): tie it to an account only by evidence.</summary>
    private async Task<StoreEventResult> ResolveNewPurchaseAsync(string token, byte[] hash, CancellationToken cancellationToken)
    {
        var snapshot = await FetchAsync(token, cancellationToken);
        if (snapshot.PlanType != GooglePlanType.AutoRenewing
            || !string.Equals(snapshot.ProductId, options.Google.ProductId, StringComparison.Ordinal)
            || (snapshot.BasePlanId is not null && !string.Equals(snapshot.BasePlanId, options.Google.BasePlanId, StringComparison.Ordinal)))
        {
            return StoreEventResult.Ignored;
        }

        long? userId = null;
        if (!string.IsNullOrEmpty(snapshot.ObfuscatedAccountId))
        {
            userId = await store.FindUserIdByAccountKeyAsync(snapshot.ObfuscatedAccountId, cancellationToken);
        }

        if (userId is null && !string.IsNullOrEmpty(snapshot.LinkedPurchaseToken))
        {
            var previous = await store.FindPurchaseAsync(tokens.Hash(snapshot.LinkedPurchaseToken), cancellationToken);
            userId = previous?.UserId;
        }

        if (userId is null)
        {
            // No evidence ties it to any account: never guess. It stays unlinked until its owner presents it through /verify.
            return StoreEventResult.Unlinked;
        }

        var record = await ApplyAsync(token, hash, snapshot, userId, cancellationToken);
        await AcknowledgeIfNeededAsync(record, token, snapshot, cancellationToken);
        return StoreEventResult.Processed;
    }

    private async Task ApplyFetchedAsync(string token, long? userId, StorePurchaseRecord existing, CancellationToken cancellationToken)
    {
        var hash = tokens.Hash(token);
        var snapshot = await FetchAsync(token, cancellationToken);
        var record = await ApplyAsync(token, hash, snapshot, userId, cancellationToken);
        telemetry.PurchaseReconciled(record.Id, existing.State, record.State);
        await AcknowledgeIfNeededAsync(record, token, snapshot, cancellationToken);
    }

    private async Task<GoogleSubscriptionSnapshot> FetchAsync(string token, CancellationToken cancellationToken)
    {
        try
        {
            return await google.GetSubscriptionAsync(options.Google.PackageName, token, options.Google.ProductId!, cancellationToken);
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException)
        {
            telemetry.GoogleCallFailed("subscriptionsv2.get", exception.GetType().Name);
            throw;
        }
    }

    private Task<StorePurchaseRecord> ApplyAsync(string token, byte[] hash, GoogleSubscriptionSnapshot snapshot, long? userId, CancellationToken cancellationToken)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var normalized = GooglePurchaseNormalizer.Normalize(snapshot, nowUtc);
        return store.UpsertPurchaseAsync(
            new UpsertPurchaseCommand(hash, tokens.Seal(token), snapshot.ProductId, snapshot.BasePlanId, snapshot.StartTimeUtc, normalized, userId, AllowClaimDetached: false, nowUtc),
            cancellationToken);
    }

    private async Task AcknowledgeIfNeededAsync(StorePurchaseRecord record, string token, GoogleSubscriptionSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (!snapshot.AcknowledgementPending)
        {
            if (record.AcknowledgementPending)
            {
                await store.MarkAcknowledgedAsync(record.Id, timeProvider.GetUtcNow(), cancellationToken);
            }

            return;
        }

        if (record.State is not (StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled))
        {
            return;
        }

        try
        {
            await google.AcknowledgeAsync(options.Google.PackageName, snapshot.ProductId, token, cancellationToken);
            await store.MarkAcknowledgedAsync(record.Id, timeProvider.GetUtcNow(), cancellationToken);
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException or GooglePlayPurchaseNotFoundException)
        {
            // Stays flagged; the next reconciliation retries.
            telemetry.AcknowledgeFailed(record.Id);
        }
    }

    /// <summary>The store no longer knows the token: the purchase ended (at its earliest known end, never "now" of the request).</summary>
    private UpsertPurchaseCommand Lapsed(StorePurchaseRecord purchase, string token)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var end = purchase.AccessEndsAtUtc is { } known && known < nowUtc ? known : nowUtc;
        var normalized = new NormalizedPurchase(StorePurchaseState.Expired, EntitlementReason.None, end, null, AcknowledgementPending: false, nowUtc + TimeSpan.FromDays(365));
        return new UpsertPurchaseCommand(
            tokens.Hash(token),
            purchase.VerificationHandleEncrypted ?? tokens.Seal(token),
            purchase.ProductId,
            null,
            null,
            normalized,
            purchase.UserId,
            AllowClaimDetached: false,
            nowUtc);
    }

    private static TimeSpan Backoff(int attempt)
    {
        var minutes = Math.Pow(2, Math.Min(attempt, 10));
        var delay = TimeSpan.FromMinutes(minutes);
        return delay > MaxBackoff ? MaxBackoff : delay;
    }
}
