using Juple.Domain.Billing;

namespace Juple.Application.Billing.GooglePlay;

/// <summary>
/// Structured operational signals for billing - the names a future telemetry setup (Application Insights / OpenTelemetry) will
/// carry. Implementations must never log a purchase token, a sealed token, a service-account credential, an OIDC token or an
/// Authorization header: only internal ids, normalized states and result codes.
/// </summary>
public interface IBillingTelemetry
{
    void VerifyCompleted(long purchaseId, GoogleVerifyOutcome outcome, StorePurchaseState state);

    void VerifyRejected(string reason);

    void PurchaseConflict(string operation);

    void GoogleCallFailed(string operation, string errorType);

    void AcknowledgeFailed(long purchaseId);

    void EventIngested(long eventId, bool isNew, string eventType);

    void EventProcessed(long eventId, StoreEventResult result);

    void EventRetryScheduled(long eventId, int attempt, string errorCode);

    void PurchaseReconciled(long purchaseId, StorePurchaseState from, StorePurchaseState to);
}

public interface IGoogleBillingService
{
    Task<GoogleCatalog> GetCatalogAsync(long userId, CancellationToken cancellationToken = default);

    Task<GoogleVerifyResult> VerifyAsync(long userId, string purchaseToken, CancellationToken cancellationToken = default);

    Task<GoogleRestoreResult> RestoreAsync(long userId, IReadOnlyList<string> purchaseTokens, CancellationToken cancellationToken = default);
}

/// <summary>
/// The client-facing half of Google billing: catalog, verify and restore. The store is proof of payment and the Juple backend is
/// the access truth: nothing the client says about price, expiry, state, package, account or entitlement is believed - only the
/// purchase token is taken, and everything else is fetched from Google (<c>purchases.subscriptionsv2.get</c>) and checked against
/// the allowlisted product and the caller's own opaque account id. A token already linked to another account is never
/// transferred (409); acknowledgement happens here, server-side, only after verification and persistence succeeded.
/// </summary>
public sealed class GoogleBillingService(
    BillingOptions options,
    IGooglePlayClient google,
    IGoogleBillingStore store,
    IGoogleAccountIdProvider accountIds,
    IPurchaseTokenProtector tokens,
    IBillingTelemetry telemetry,
    TimeProvider timeProvider) : IGoogleBillingService
{
    private const int MaxTokenLength = 4096;
    private const int MaxRestoreTokens = 10;

    public async Task<GoogleCatalog> GetCatalogAsync(long userId, CancellationToken cancellationToken = default)
    {
        var settings = options.Google;
        if (!settings.Enabled)
        {
            return new GoogleCatalog(false, null, null, null);
        }

        var accountKey = accountIds.Compute(userId);
        await store.EnsureAccountLinkAsync(userId, accountKey, timeProvider.GetUtcNow(), cancellationToken);
        return new GoogleCatalog(true, settings.ProductId, settings.BasePlanId, accountKey);
    }

    public async Task<GoogleVerifyResult> VerifyAsync(long userId, string purchaseToken, CancellationToken cancellationToken = default)
    {
        RequireEnabled();
        var token = NormalizeToken(purchaseToken);
        var hash = tokens.Hash(token);

        var existing = await store.FindPurchaseAsync(hash, cancellationToken);
        if (existing is { UserId: { } owner } && owner != userId)
        {
            telemetry.PurchaseConflict("verify");
            throw new PurchaseBelongsToAnotherAccountException();
        }

        var accountKey = accountIds.Compute(userId);
        await store.EnsureAccountLinkAsync(userId, accountKey, timeProvider.GetUtcNow(), cancellationToken);

        var snapshot = await FetchAsync(token, cancellationToken);
        var allowClaim = await ValidateAndResolveOwnershipAsync(userId, accountKey, snapshot, existing, cancellationToken);

        var record = await ApplyAsync(token, hash, snapshot, userId, allowClaim, cancellationToken);
        var acknowledged = await AcknowledgeIfNeededAsync(record, token, snapshot, cancellationToken);
        var normalizedState = record.State;
        var outcome = normalizedState switch
        {
            StorePurchaseState.Pending => GoogleVerifyOutcome.Pending,
            StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled => GoogleVerifyOutcome.Verified,
            _ => GoogleVerifyOutcome.NotEntitled,
        };
        telemetry.VerifyCompleted(record.Id, outcome, normalizedState);
        return new GoogleVerifyResult(outcome, normalizedState, acknowledged);
    }

    public async Task<GoogleRestoreResult> RestoreAsync(long userId, IReadOnlyList<string> purchaseTokens, CancellationToken cancellationToken = default)
    {
        RequireEnabled();
        var distinct = purchaseTokens
            .Where(token => !string.IsNullOrWhiteSpace(token))
            .Select(token => token.Trim())
            .Distinct(StringComparer.Ordinal)
            .Take(MaxRestoreTokens)
            .ToList();

        var restored = false;
        var conflict = false;
        var temporary = false;

        if (distinct.Count == 0)
        {
            // No tokens offered: refresh the account's own known purchases from Google.
            foreach (var purchase in await store.ListPurchasesForUserAsync(userId, cancellationToken))
            {
                try
                {
                    var result = await ReconcileStoredAsync(purchase, cancellationToken);
                    restored |= result is StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled;
                }
                catch (GooglePlayUnavailableException)
                {
                    temporary = true;
                }
            }
        }

        foreach (var token in distinct)
        {
            try
            {
                var result = await VerifyAsync(userId, token, cancellationToken);
                restored |= result.Outcome == GoogleVerifyOutcome.Verified;
            }
            catch (PurchaseBelongsToAnotherAccountException)
            {
                conflict = true;
            }
            catch (GooglePlayUnavailableException)
            {
                temporary = true;
            }
            catch (Exception exception) when (exception is PurchaseNotAllowedException or GooglePlayPurchaseNotFoundException or GooglePlayMalformedResponseException)
            {
                // Not a purchase of this product / not a valid token: simply nothing to restore from it.
            }
        }

        var outcome = restored
            ? GoogleRestoreOutcome.Restored
            : conflict
                ? GoogleRestoreOutcome.BelongsToAnotherJupleAccount
                : temporary ? GoogleRestoreOutcome.TemporaryFailure : GoogleRestoreOutcome.NothingFound;
        return new GoogleRestoreResult(outcome);
    }

    private async Task<StorePurchaseState> ReconcileStoredAsync(StorePurchaseRecord purchase, CancellationToken cancellationToken)
    {
        var token = tokens.Open(purchase.VerificationHandleEncrypted);
        var hash = tokens.Hash(token);
        var snapshot = await FetchAsync(token, cancellationToken);
        var record = await ApplyAsync(token, hash, snapshot, purchase.UserId, allowClaimDetached: false, cancellationToken);
        await AcknowledgeIfNeededAsync(record, token, snapshot, cancellationToken);
        return record.State;
    }

    private void RequireEnabled()
    {
        if (!options.Google.Enabled)
        {
            throw new BillingNotEnabledException();
        }
    }

    private static string NormalizeToken(string purchaseToken)
    {
        var token = purchaseToken?.Trim();
        if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength)
        {
            throw new GooglePlayPurchaseNotFoundException();
        }

        return token;
    }

    private async Task<GoogleSubscriptionSnapshot> FetchAsync(string token, CancellationToken cancellationToken)
    {
        try
        {
            return await google.GetSubscriptionAsync(options.Google.PackageName, token, options.Google.ProductId!, cancellationToken);
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException or GooglePlayPurchaseNotFoundException)
        {
            telemetry.GoogleCallFailed("subscriptionsv2.get", exception.GetType().Name);
            throw;
        }
    }

    /// <summary>
    /// The product must be the allowlisted one; the purchase must carry an obfuscated account id that is this caller's, or - for a
    /// purchase whose own account no longer exists (detached when it was deleted) - one that belongs to no live account, which a
    /// verified restore may claim. An id belonging to ANOTHER live account is a conflict. Returns whether a claim of a detached
    /// purchase is allowed.
    /// </summary>
    private async Task<bool> ValidateAndResolveOwnershipAsync(
        long userId,
        string accountKey,
        GoogleSubscriptionSnapshot snapshot,
        StorePurchaseRecord? existing,
        CancellationToken cancellationToken)
    {
        if (snapshot.PlanType != GooglePlanType.AutoRenewing)
        {
            telemetry.VerifyRejected("planType");
            throw new PurchaseNotAllowedException(PurchaseRejectionReason.PlanType);
        }

        if (!string.Equals(snapshot.ProductId, options.Google.ProductId, StringComparison.Ordinal)
            || (snapshot.BasePlanId is not null && !string.Equals(snapshot.BasePlanId, options.Google.BasePlanId, StringComparison.Ordinal)))
        {
            telemetry.VerifyRejected("product");
            throw new PurchaseNotAllowedException(PurchaseRejectionReason.Product);
        }

        if (string.IsNullOrEmpty(snapshot.ObfuscatedAccountId))
        {
            telemetry.VerifyRejected("account");
            throw new PurchaseNotAllowedException(PurchaseRejectionReason.Account);
        }

        if (string.Equals(snapshot.ObfuscatedAccountId, accountKey, StringComparison.Ordinal))
        {
            return false;
        }

        var other = await store.FindUserIdByAccountKeyAsync(snapshot.ObfuscatedAccountId, cancellationToken);
        if (other is { } otherUser && otherUser != userId)
        {
            telemetry.PurchaseConflict("verify");
            throw new PurchaseBelongsToAnotherAccountException();
        }

        if (other is null && existing is { UserId: null })
        {
            // Its account was deleted: a verified restore by a signed-in account may take it over.
            return true;
        }

        telemetry.VerifyRejected("account");
        throw new PurchaseNotAllowedException(PurchaseRejectionReason.Account);
    }

    private async Task<StorePurchaseRecord> ApplyAsync(
        string token,
        byte[] hash,
        GoogleSubscriptionSnapshot snapshot,
        long? userId,
        bool allowClaimDetached,
        CancellationToken cancellationToken)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var normalized = GooglePurchaseNormalizer.Normalize(snapshot, nowUtc);
        try
        {
            return await store.UpsertPurchaseAsync(
                new UpsertPurchaseCommand(hash, tokens.Seal(token), snapshot.ProductId, snapshot.BasePlanId, snapshot.StartTimeUtc, normalized, userId, allowClaimDetached, nowUtc),
                cancellationToken);
        }
        catch (StorePurchaseOwnershipConflictException)
        {
            telemetry.PurchaseConflict("upsert");
            throw new PurchaseBelongsToAnotherAccountException();
        }
    }

    /// <summary>
    /// Server-side acknowledgement, only for a PAID purchase the store still lists as unacknowledged, and only after it was
    /// verified and persisted. A failure does not undo the verification: the purchase stays flagged and the reconciliation job retries
    /// (Google refunds an unacknowledged purchase after about three days). If the on-device finish got there first, Google already
    /// reports it acknowledged - which a re-fetch confirms - and that is success.
    /// </summary>
    private async Task<bool> AcknowledgeIfNeededAsync(StorePurchaseRecord record, string token, GoogleSubscriptionSnapshot snapshot, CancellationToken cancellationToken)
    {
        if (!snapshot.AcknowledgementPending)
        {
            await MarkAckedIfFlaggedAsync(record, cancellationToken);
            return true;
        }

        if (record.State is not (StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled))
        {
            return false;
        }

        try
        {
            await google.AcknowledgeAsync(options.Google.PackageName, snapshot.ProductId, token, cancellationToken);
        }
        catch (Exception exception) when (exception is GooglePlayUnavailableException or GooglePlayMalformedResponseException or GooglePlayPurchaseNotFoundException)
        {
            telemetry.AcknowledgeFailed(record.Id);
            try
            {
                var again = await google.GetSubscriptionAsync(options.Google.PackageName, token, options.Google.ProductId!, cancellationToken);
                if (!again.AcknowledgementPending)
                {
                    await store.MarkAcknowledgedAsync(record.Id, timeProvider.GetUtcNow(), cancellationToken);
                    return true;
                }
            }
            catch (Exception recheck) when (recheck is GooglePlayUnavailableException or GooglePlayMalformedResponseException or GooglePlayPurchaseNotFoundException)
            {
                telemetry.GoogleCallFailed("subscriptionsv2.get", recheck.GetType().Name);
            }

            return false;
        }

        await store.MarkAcknowledgedAsync(record.Id, timeProvider.GetUtcNow(), cancellationToken);
        return true;
    }

    private Task MarkAckedIfFlaggedAsync(StorePurchaseRecord record, CancellationToken cancellationToken) =>
        record.AcknowledgementPending
            ? store.MarkAcknowledgedAsync(record.Id, timeProvider.GetUtcNow(), cancellationToken)
            : Task.CompletedTask;
}
