using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.Application.Billing.Apple;

public enum AppleIngestOutcome
{
    /// <summary>Verified and durably recorded (or a redelivery of one already recorded).</summary>
    Accepted,

    /// <summary>For another app or an environment Juple does not accept: acknowledged (so Apple stops retrying) but never acted on.</summary>
    Ignored,
}

public sealed record AppleIngestResult(AppleIngestOutcome Outcome, StoreEventInsertResult? Event);

public interface IAppleBillingProcessor
{
    /// <summary>
    /// Verifies an App Store Server Notification V2 (<c>signedPayload</c>) and durably records it, idempotent on the notification UUID.
    /// Throws <see cref="AppleSignatureException"/> / <see cref="AppleMalformedException"/> for anything that is not a verifiable notification.
    /// </summary>
    Task<AppleIngestResult> IngestAsync(string signedPayload, CancellationToken cancellationToken = default);

    Task<ProcessOutcome> ProcessEventAsync(long eventId, CancellationToken cancellationToken = default);

    Task<ProcessOutcome> ReconcilePurchaseAsync(long purchaseId, CancellationToken cancellationToken = default);

    Task<SweepSummary> SweepAsync(int eventLimit, int purchaseLimit, CancellationToken cancellationToken = default);
}

/// <summary>
/// The asynchronous half of App Store billing: Server Notifications V2 and the periodic reconciliation. A notification is only ever a
/// REASON TO ASK APPLE - its type is never applied. Processing fetches the authoritative subscription status and applies it, so
/// duplicates, replays and out-of-order deliveries all converge on Apple's current truth. A purchase is tied to an account only by
/// evidence: the original transaction already linked, or the App Account Token Juple gave StoreKit; anything else stays Unlinked.
/// </summary>
public sealed class AppleBillingProcessor(
    BillingOptions options,
    IAppleStoreServerClient apple,
    IAppleJwsVerifier jws,
    IAppleBillingStore store,
    IApplePurchaseHandleProtector handles,
    IBillingEventSignal signal,
    IBillingTelemetry telemetry,
    TimeProvider timeProvider) : IAppleBillingProcessor
{
    private static readonly TimeSpan EventLease = TimeSpan.FromMinutes(5);
    private static readonly TimeSpan PurchaseLease = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxBackoff = TimeSpan.FromHours(6);
    private const int MaxAttempts = 30;
    private const int MaxEventTypeLength = 64;

    public async Task<AppleIngestResult> IngestAsync(string signedPayload, CancellationToken cancellationToken = default)
    {
        var notification = ApplePayloads.ParseNotification(jws.VerifyAndGetPayload(signedPayload), jws);
        if (!IsOurs(notification))
        {
            return new AppleIngestResult(AppleIngestOutcome.Ignored, null);
        }

        var nowUtc = timeProvider.GetUtcNow();
        var transaction = notification.Transaction;
        string? handle = transaction is null ? null : ApplePayloads.ToHandle(transaction.Environment, transaction.OriginalTransactionId);
        var eventType = notification.Subtype is { Length: > 0 } ? $"{notification.NotificationType}:{notification.Subtype}" : notification.NotificationType;
        if (eventType.Length > MaxEventTypeLength)
        {
            eventType = eventType[..MaxEventTypeLength];
        }

        var storeEvent = new StoreEvent(
            StoreSource.AppStore,
            notification.NotificationUuid,
            eventType,
            transaction is null ? null : handles.Hash(transaction.OriginalTransactionId),
            handle is null ? null : handles.Seal(handle),
            nowUtc);

        // DURABLE FIRST: the event is committed before anything is signalled; a redelivery is the same event (unique index).
        var inserted = await store.TryInsertEventAsync(storeEvent, cancellationToken);
        telemetry.EventIngested(inserted.Id, inserted.IsNew, eventType);

        if (inserted.IsNew && await signal.TrySignalAsync(inserted.Id, cancellationToken))
        {
            await store.MarkEventDispatchedAsync(inserted.Id, timeProvider.GetUtcNow(), cancellationToken);
        }

        return new AppleIngestResult(AppleIngestOutcome.Accepted, inserted);
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
        catch (Exception exception) when (exception is AppleUnavailableException or AppleMalformedException or PurchaseTokenTamperedException or StorePurchaseOwnershipConflictException)
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
        if (purchase?.VerificationHandleEncrypted is not { } sealedHandle)
        {
            return ProcessOutcome.NotTaken;
        }

        string? handle = null;
        try
        {
            handle = handles.Open(sealedHandle);
            var (environment, originalTransactionId) = ApplePayloads.FromHandle(handle);
            await ApplyFetchedAsync(originalTransactionId, environment, purchase.UserId, purchase, cancellationToken);
            return ProcessOutcome.Processed;
        }
        catch (AppleTransactionNotFoundException) when (handle is not null)
        {
            // Apple forgot the transaction (it is only kept for a while after the end): the purchase simply ended.
            await store.UpsertPurchaseAsync(Lapsed(purchase, sealedHandle), cancellationToken);
            return ProcessOutcome.Processed;
        }
        catch (Exception exception) when (exception is AppleUnavailableException or AppleMalformedException or PurchaseTokenTamperedException)
        {
            telemetry.AppleCallFailed("reconcile", exception.GetType().Name);
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

    /// <summary>A notification for another app, or from an environment Juple does not accept, is acknowledged but never acted on.</summary>
    private bool IsOurs(AppleNotification notification)
    {
        if (notification.Transaction is null && notification.BundleId.Length == 0)
        {
            // TEST and other payloads without a purchase: recorded (so a test notification can be seen working) and ignored by processing.
            return true;
        }

        var bundleMatches = string.Equals(notification.BundleId, options.Apple.BundleId, StringComparison.Ordinal);
        var environmentAccepted = notification.Environment == AppleEnvironment.Production || options.Apple.AcceptSandbox;
        return bundleMatches && environmentAccepted;
    }

    private async Task<StoreEventResult> ReconcileEventAsync(StoreEventWork work, CancellationToken cancellationToken)
    {
        if (work.EncryptedToken is null || work.TokenHash is null)
        {
            return StoreEventResult.Ignored;
        }

        var (environment, originalTransactionId) = ApplePayloads.FromHandle(handles.Open(work.EncryptedToken));
        var existing = await store.FindPurchaseAsync(work.TokenHash, cancellationToken);
        try
        {
            if (existing is not null)
            {
                await ApplyFetchedAsync(originalTransactionId, environment, existing.UserId, existing, cancellationToken);
                return StoreEventResult.Processed;
            }

            return await ResolveNewPurchaseAsync(originalTransactionId, environment, work.TokenHash, cancellationToken);
        }
        catch (AppleTransactionNotFoundException)
        {
            if (existing is not null)
            {
                await store.UpsertPurchaseAsync(Lapsed(existing, work.EncryptedToken), cancellationToken);
                return StoreEventResult.Processed;
            }

            return StoreEventResult.Ignored;
        }
    }

    /// <summary>A purchase Juple has not recorded yet (the app never reached /verify): tie it to an account only by evidence.</summary>
    private async Task<StoreEventResult> ResolveNewPurchaseAsync(string originalTransactionId, AppleEnvironment environment, byte[] hash, CancellationToken cancellationToken)
    {
        var snapshot = await FetchAsync(originalTransactionId, environment, cancellationToken);
        var transaction = snapshot.Transaction;
        if (!string.Equals(transaction.BundleId, options.Apple.BundleId, StringComparison.Ordinal)
            || !options.Apple.ProductIds.Contains(transaction.ProductId, StringComparer.Ordinal))
        {
            return StoreEventResult.Ignored;
        }

        long? userId = null;
        if (transaction.AppAccountToken is { } presented)
        {
            userId = await store.FindUserIdByAccountKeyAsync(presented.ToString("D"), cancellationToken);
        }

        if (userId is null)
        {
            // No evidence ties it to any account: never guess. It stays unlinked until its owner presents it through /verify.
            return StoreEventResult.Unlinked;
        }

        await ApplyAsync(hash, snapshot, userId, cancellationToken);
        return StoreEventResult.Processed;
    }

    private async Task ApplyFetchedAsync(string originalTransactionId, AppleEnvironment environment, long? userId, StorePurchaseRecord existing, CancellationToken cancellationToken)
    {
        var snapshot = await FetchAsync(originalTransactionId, environment, cancellationToken);
        var record = await ApplyAsync(handles.Hash(originalTransactionId), snapshot, userId, cancellationToken);
        telemetry.PurchaseReconciled(record.Id, existing.State, record.State);
    }

    private async Task<AppleSubscriptionSnapshot> FetchAsync(string originalTransactionId, AppleEnvironment environment, CancellationToken cancellationToken)
    {
        try
        {
            return await apple.GetSubscriptionStatusAsync(originalTransactionId, environment, cancellationToken);
        }
        catch (Exception exception) when (exception is AppleUnavailableException or AppleMalformedException)
        {
            telemetry.AppleCallFailed("subscriptions.get", exception.GetType().Name);
            throw;
        }
    }

    private Task<StorePurchaseRecord> ApplyAsync(byte[] hash, AppleSubscriptionSnapshot snapshot, long? userId, CancellationToken cancellationToken)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var normalized = AppleSubscriptionNormalizer.Normalize(snapshot, nowUtc);
        var handle = ApplePayloads.ToHandle(snapshot.Transaction.Environment, snapshot.Transaction.OriginalTransactionId);
        return store.UpsertPurchaseAsync(
            new UpsertPurchaseCommand(hash, handles.Seal(handle), snapshot.Transaction.ProductId, null, snapshot.Transaction.OriginalPurchaseDateUtc, normalized, userId, AllowClaimDetached: false, nowUtc),
            cancellationToken);
    }

    /// <summary>The store no longer knows the transaction: the purchase ended (at its earliest known end, never "now" of the request).</summary>
    private UpsertPurchaseCommand Lapsed(StorePurchaseRecord purchase, byte[] sealedHandle)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var end = purchase.AccessEndsAtUtc is { } known && known < nowUtc ? known : nowUtc;
        var normalized = new NormalizedPurchase(StorePurchaseState.Expired, EntitlementReason.None, end, null, AcknowledgementPending: false, nowUtc + TimeSpan.FromDays(365));
        var (_, originalTransactionId) = ApplePayloads.FromHandle(handles.Open(sealedHandle));
        return new UpsertPurchaseCommand(handles.Hash(originalTransactionId), sealedHandle, purchase.ProductId, null, null, normalized, purchase.UserId, AllowClaimDetached: false, nowUtc);
    }

    private static TimeSpan Backoff(int attempt)
    {
        var minutes = Math.Pow(2, Math.Min(attempt, 10));
        var delay = TimeSpan.FromMinutes(minutes);
        return delay > MaxBackoff ? MaxBackoff : delay;
    }
}
