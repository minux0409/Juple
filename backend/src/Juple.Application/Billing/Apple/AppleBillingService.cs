using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.Application.Billing.Apple;

/// <summary>The App Store flavour of the store purchase repository: the same operations, App Store rows, App Account Tokens as account keys.</summary>
public interface IAppleBillingStore : IGoogleBillingStore;

/// <summary>Reads the authoritative subscription status from the App Store Server API (never trusts anything the app says).</summary>
public interface IAppleStoreServerClient
{
    /// <summary>Throws <see cref="AppleTransactionNotFoundException"/>, <see cref="AppleUnavailableException"/> or <see cref="AppleMalformedException"/>.</summary>
    Task<AppleSubscriptionSnapshot> GetSubscriptionStatusAsync(string originalTransactionId, AppleEnvironment environment, CancellationToken cancellationToken = default);
}

public interface IAppleBillingService
{
    Task<AppleCatalog> GetCatalogAsync(long userId, CancellationToken cancellationToken = default);

    Task<AppleVerifyResult> VerifyAsync(long userId, string signedTransaction, CancellationToken cancellationToken = default);

    Task<AppleRestoreResult> RestoreAsync(long userId, IReadOnlyList<string> signedTransactions, CancellationToken cancellationToken = default);
}

/// <summary>
/// The client-facing half of App Store billing. The store is proof of payment and the Juple backend is the access truth: the app hands
/// over the signed transaction StoreKit 2 gave it, but only the ORIGINAL TRANSACTION ID inside it (after its Apple signature verified)
/// is used - the subscription's state, expiry, product and App Account Token are read again from the App Store Server API and checked
/// against the allowlisted products and the caller's own App Account Token. A transaction already linked to another account is never
/// transferred (409). There is nothing to acknowledge: StoreKit's <c>finish()</c> is the app's business once the server confirmed.
/// </summary>
public sealed class AppleBillingService(
    BillingOptions options,
    IAppleStoreServerClient apple,
    IAppleJwsVerifier jws,
    IAppleBillingStore store,
    IAppleAccountTokenProvider accountTokens,
    IApplePurchaseHandleProtector handles,
    IBillingTelemetry telemetry,
    TimeProvider timeProvider) : IAppleBillingService
{
    private const int MaxRestoreTransactions = 10;
    private const string SubscriptionType = "Auto-Renewable Subscription";

    public async Task<AppleCatalog> GetCatalogAsync(long userId, CancellationToken cancellationToken = default)
    {
        if (!options.Apple.Enabled)
        {
            return new AppleCatalog(false, [], null);
        }

        var token = accountTokens.Compute(userId);
        await store.EnsureAccountLinkAsync(userId, token.ToString("D"), timeProvider.GetUtcNow(), cancellationToken);
        return new AppleCatalog(true, options.Apple.ProductIds.ToArray(), token);
    }

    public async Task<AppleVerifyResult> VerifyAsync(long userId, string signedTransaction, CancellationToken cancellationToken = default)
    {
        RequireEnabled();
        var claimed = ReadClaimedTransaction(signedTransaction);
        var hash = handles.Hash(claimed.OriginalTransactionId);

        var existing = await store.FindPurchaseAsync(hash, cancellationToken);
        if (existing is { UserId: { } owner } && owner != userId)
        {
            telemetry.PurchaseConflict("verify");
            throw new PurchaseBelongsToAnotherAccountException();
        }

        var token = accountTokens.Compute(userId);
        await store.EnsureAccountLinkAsync(userId, token.ToString("D"), timeProvider.GetUtcNow(), cancellationToken);

        var snapshot = await FetchAsync(claimed.OriginalTransactionId, claimed.Environment, cancellationToken);
        EnsureAllowed(snapshot.Transaction);
        var allowClaim = await ResolveOwnershipAsync(userId, token, snapshot, existing, cancellationToken);

        var record = await ApplyAsync(hash, snapshot, userId, allowClaim, cancellationToken);
        var outcome = record.State switch
        {
            StorePurchaseState.Pending => GoogleVerifyOutcome.Pending,
            StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled => GoogleVerifyOutcome.Verified,
            _ => GoogleVerifyOutcome.NotEntitled,
        };
        telemetry.VerifyCompleted(record.Id, outcome, record.State);
        return new AppleVerifyResult(outcome, record.State);
    }

    public async Task<AppleRestoreResult> RestoreAsync(long userId, IReadOnlyList<string> signedTransactions, CancellationToken cancellationToken = default)
    {
        RequireEnabled();
        var distinct = signedTransactions
            .Where(transaction => !string.IsNullOrWhiteSpace(transaction))
            .Select(transaction => transaction.Trim())
            .Distinct(StringComparer.Ordinal)
            .Take(MaxRestoreTransactions)
            .ToList();

        var restored = false;
        var conflict = false;
        var temporary = false;

        if (distinct.Count == 0)
        {
            // Nothing offered (e.g. a fresh install that has not synced): refresh the account's own known purchases from the App Store.
            foreach (var purchase in await store.ListPurchasesForUserAsync(userId, cancellationToken))
            {
                if (purchase.VerificationHandleEncrypted is not { } sealedHandle)
                {
                    continue;
                }

                try
                {
                    var (environment, originalTransactionId) = ApplePayloads.FromHandle(handles.Open(sealedHandle));
                    var snapshot = await FetchAsync(originalTransactionId, environment, cancellationToken);
                    var record = await ApplyAsync(handles.Hash(originalTransactionId), snapshot, purchase.UserId, allowClaimDetached: false, cancellationToken);
                    restored |= record.State is StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled;
                }
                catch (Exception exception) when (exception is AppleUnavailableException or AppleMalformedException or AppleTransactionNotFoundException or PurchaseTokenTamperedException)
                {
                    temporary |= exception is AppleUnavailableException;
                }
            }
        }

        foreach (var signed in distinct)
        {
            try
            {
                var result = await VerifyAsync(userId, signed, cancellationToken);
                restored |= result.Outcome == GoogleVerifyOutcome.Verified;
            }
            catch (PurchaseBelongsToAnotherAccountException)
            {
                conflict = true;
            }
            catch (AppleUnavailableException)
            {
                temporary = true;
            }
            catch (Exception exception) when (exception is PurchaseNotAllowedException or AppleTransactionNotFoundException or AppleMalformedException or AppleSignatureException)
            {
                // Not a Juple transaction / not a valid one: simply nothing to restore from it.
            }
        }

        var outcome = restored
            ? AppleRestoreOutcome.Restored
            : conflict
                ? AppleRestoreOutcome.BelongsToAnotherJupleAccount
                : temporary ? AppleRestoreOutcome.TemporaryFailure : AppleRestoreOutcome.NothingFound;
        return new AppleRestoreResult(outcome);
    }

    private void RequireEnabled()
    {
        if (!options.Apple.Enabled)
        {
            throw new BillingNotEnabledException();
        }
    }

    /// <summary>Verifies the Apple signature and reads only the identity of the transaction; everything it carries is re-read from Apple.</summary>
    private AppleTransaction ReadClaimedTransaction(string signedTransaction)
    {
        var transaction = ApplePayloads.ParseTransaction(jws.VerifyAndGetPayload(signedTransaction));
        EnsureAllowed(transaction);
        return transaction;
    }

    private void EnsureAllowed(AppleTransaction transaction)
    {
        if (!string.Equals(transaction.BundleId, options.Apple.BundleId, StringComparison.Ordinal)
            || !options.Apple.ProductIds.Contains(transaction.ProductId, StringComparer.Ordinal)
            || (transaction.Type is not null && !string.Equals(transaction.Type, SubscriptionType, StringComparison.Ordinal))
            || (transaction.Environment == AppleEnvironment.Sandbox && !options.Apple.AcceptSandbox))
        {
            telemetry.VerifyRejected("product");
            throw new PurchaseNotAllowedException(PurchaseRejectionReason.Product);
        }
    }

    private async Task<AppleSubscriptionSnapshot> FetchAsync(string originalTransactionId, AppleEnvironment environment, CancellationToken cancellationToken)
    {
        try
        {
            var snapshot = await apple.GetSubscriptionStatusAsync(originalTransactionId, environment, cancellationToken);
            if (!string.Equals(snapshot.Transaction.OriginalTransactionId, originalTransactionId, StringComparison.Ordinal))
            {
                throw new AppleMalformedException("The App Store answered for another transaction.");
            }

            return snapshot;
        }
        catch (Exception exception) when (exception is AppleUnavailableException or AppleMalformedException or AppleTransactionNotFoundException)
        {
            telemetry.AppleCallFailed("subscriptions.get", exception.GetType().Name);
            throw;
        }
    }

    /// <summary>
    /// The transaction must carry an App Account Token that is this caller's, or - for a purchase whose own account no longer exists
    /// (detached when it was deleted) - one that belongs to no live account, which a verified restore may claim. A token belonging to
    /// ANOTHER live account is a conflict.
    /// </summary>
    private async Task<bool> ResolveOwnershipAsync(long userId, Guid token, AppleSubscriptionSnapshot snapshot, StorePurchaseRecord? existing, CancellationToken cancellationToken)
    {
        if (snapshot.Transaction.AppAccountToken is not { } presented)
        {
            telemetry.VerifyRejected("account");
            throw new PurchaseNotAllowedException(PurchaseRejectionReason.Account);
        }

        if (presented == token)
        {
            return false;
        }

        var other = await store.FindUserIdByAccountKeyAsync(presented.ToString("D"), cancellationToken);
        if (other is { } otherUser && otherUser != userId)
        {
            telemetry.PurchaseConflict("verify");
            throw new PurchaseBelongsToAnotherAccountException();
        }

        if (other is null && existing is { UserId: null })
        {
            return true;
        }

        telemetry.VerifyRejected("account");
        throw new PurchaseNotAllowedException(PurchaseRejectionReason.Account);
    }

    private async Task<StorePurchaseRecord> ApplyAsync(byte[] hash, AppleSubscriptionSnapshot snapshot, long? userId, bool allowClaimDetached, CancellationToken cancellationToken)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var normalized = AppleSubscriptionNormalizer.Normalize(snapshot, nowUtc);
        var handle = ApplePayloads.ToHandle(snapshot.Transaction.Environment, snapshot.Transaction.OriginalTransactionId);
        try
        {
            return await store.UpsertPurchaseAsync(
                new UpsertPurchaseCommand(hash, handles.Seal(handle), snapshot.Transaction.ProductId, null, snapshot.Transaction.OriginalPurchaseDateUtc, normalized, userId, allowClaimDetached, nowUtc),
                cancellationToken);
        }
        catch (StorePurchaseOwnershipConflictException)
        {
            telemetry.PurchaseConflict("upsert");
            throw new PurchaseBelongsToAnotherAccountException();
        }
    }
}
