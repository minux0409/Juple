using Juple.Domain.Billing;

namespace Juple.Application.Billing.GooglePlay;

/// <summary>A purchase presented by a different account than the one it belongs to. Never transferred silently.</summary>
public sealed class PurchaseBelongsToAnotherAccountException() : Exception("This purchase belongs to another Juple account.");

public enum PurchaseRejectionReason
{
    /// <summary>Not the one allowlisted product / base plan.</summary>
    Product,

    /// <summary>Its obfuscated account id is missing, or matches no account this caller may use.</summary>
    Account,

    /// <summary>Not an auto-renewing plan.</summary>
    PlanType,
}

public sealed class PurchaseNotAllowedException(PurchaseRejectionReason reason) : Exception($"The purchase was refused ({reason}).")
{
    public PurchaseRejectionReason Reason { get; } = reason;
}

public sealed class BillingNotEnabledException() : Exception("Google Play billing is not enabled.");

/// <summary>What the app needs to start a purchase. Only non-secret, non-price data; the price comes from Google Play itself.</summary>
public sealed record GoogleCatalog(bool Enabled, string? ProductId, string? BasePlanId, string? ObfuscatedAccountId);

public enum GoogleVerifyOutcome
{
    /// <summary>The purchase is verified, linked to the caller and (if paid) granting access.</summary>
    Verified,

    /// <summary>Verified with Google, but payment is still pending: no entitlement yet, nothing acknowledged.</summary>
    Pending,

    /// <summary>Verified with Google and linked, but it grants no access (expired, on hold, paused, revoked).</summary>
    NotEntitled,
}

/// <summary>The normalized verification result. No Google state, token or price is exposed; the app refreshes bootstrap for the entitlement.</summary>
public sealed record GoogleVerifyResult(GoogleVerifyOutcome Outcome, StorePurchaseState State, bool Acknowledged);

public enum GoogleRestoreOutcome
{
    Restored,
    NothingFound,
    BelongsToAnotherJupleAccount,
    TemporaryFailure,
}

public sealed record GoogleRestoreResult(GoogleRestoreOutcome Outcome);

/// <summary>A store purchase as the services see it (never the sealed token's plaintext).</summary>
public sealed record StorePurchaseRecord(
    long Id,
    long? UserId,
    string ProductId,
    StorePurchaseState State,
    EntitlementReason Reason,
    DateTimeOffset? AccessEndsAtUtc,
    byte[]? VerificationHandleEncrypted,
    bool AcknowledgementPending);

public sealed record UpsertPurchaseCommand(
    byte[] ExternalKeyHash,
    byte[] EncryptedToken,
    string ProductId,
    string? BasePlanId,
    DateTimeOffset? PeriodStartUtc,
    NormalizedPurchase Normalized,
    long? UserId,
    bool AllowClaimDetached,
    DateTimeOffset NowUtc);

public sealed class StorePurchaseOwnershipConflictException() : Exception("The purchase is linked to a different account.");

public sealed record StoreEventInsertResult(long Id, bool IsNew);

public sealed record StoreEventWork(long Id, string EventType, byte[]? TokenHash, byte[]? EncryptedToken, int AttemptCount);

public interface IGoogleBillingStore
{
    /// <summary>Idempotently records the opaque account id of an account (one per account, unique across accounts).</summary>
    Task EnsureAccountLinkAsync(long userId, string accountKey, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<long?> FindUserIdByAccountKeyAsync(string accountKey, CancellationToken cancellationToken = default);

    Task<StorePurchaseRecord?> FindPurchaseAsync(byte[] externalKeyHash, CancellationToken cancellationToken = default);

    Task<StorePurchaseRecord?> FindPurchaseAsync(long purchaseId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<StorePurchaseRecord>> ListPurchasesForUserAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Inserts or updates the purchase keyed by its token hash, atomically. Concurrent first calls converge on one row. A
    /// different owner is never taken over: <see cref="StorePurchaseOwnershipConflictException"/> - except that a DETACHED
    /// purchase (its account was deleted) may be claimed when <c>AllowClaimDetached</c> is set by a verified restore.
    /// </summary>
    Task<StorePurchaseRecord> UpsertPurchaseAsync(UpsertPurchaseCommand command, CancellationToken cancellationToken = default);

    Task MarkAcknowledgedAsync(long purchaseId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<StoreEventInsertResult> TryInsertEventAsync(StoreEvent storeEvent, CancellationToken cancellationToken = default);

    Task MarkEventDispatchedAsync(long eventId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Takes one event for processing (unprocessed and due): sets its lease. Null = nothing to do (done, not due, or taken).</summary>
    Task<StoreEventWork?> ClaimEventAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default);

    /// <summary>Ids of events not yet processed and due (including any whose wake-up signal was lost). Taking one is ClaimEventAsync's job.</summary>
    Task<IReadOnlyList<long>> ListDueEventIdsAsync(DateTimeOffset nowUtc, int limit, CancellationToken cancellationToken = default);

    Task CompleteEventAsync(long eventId, StoreEventResult result, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task FailEventAsync(long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool permanent, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Takes purchases whose reconciliation is due: pushes their next check out by the lease so a second runner skips them.</summary>
    Task<IReadOnlyList<long>> ClaimDuePurchaseIdsAsync(DateTimeOffset nowUtc, TimeSpan lease, int limit, CancellationToken cancellationToken = default);
}

/// <summary>Wakes the billing worker for a stored event. Best effort by design - the SQL event is the record and the sweep recovers any miss.</summary>
public interface IBillingEventSignal
{
    Task<bool> TrySignalAsync(long eventId, CancellationToken cancellationToken = default);
}

/// <summary>Verifies the OIDC token Google Pub/Sub attaches to a push (audience and caller identity). Business logic never sees the token.</summary>
public interface IPubSubPushAuthenticator
{
    Task<bool> AuthenticateAsync(string? authorizationHeader, CancellationToken cancellationToken = default);
}
