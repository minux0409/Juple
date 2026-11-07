using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;

namespace Juple.Application.Billing.Apple;

public enum AppleEnvironment
{
    Production,
    Sandbox,
}

/// <summary>The fields of a verified <c>JWSTransactionDecodedPayload</c> that Juple uses. Nothing else is read or stored.</summary>
public sealed record AppleTransaction(
    string TransactionId,
    string OriginalTransactionId,
    string BundleId,
    string ProductId,
    DateTimeOffset? PurchaseDateUtc,
    DateTimeOffset? OriginalPurchaseDateUtc,
    DateTimeOffset? ExpiresDateUtc,
    DateTimeOffset? RevocationDateUtc,
    Guid? AppAccountToken,
    AppleEnvironment Environment,
    string? Type);

/// <summary>The fields of a verified <c>JWSRenewalInfoDecodedPayload</c> that Juple uses.</summary>
public sealed record AppleRenewalInfo(
    string OriginalTransactionId,
    string? AutoRenewProductId,
    bool? AutoRenews,
    int? ExpirationIntent,
    bool? IsInBillingRetryPeriod,
    DateTimeOffset? GracePeriodExpiresDateUtc);

/// <summary>The App Store Server API subscription status codes (<c>Status</c>).</summary>
public enum AppleSubscriptionStatus
{
    Active = 1,
    Expired = 2,
    BillingRetry = 3,
    BillingGracePeriod = 4,
    Revoked = 5,
}

/// <summary>What the App Store Server API reported for one subscription's latest transaction: the authoritative state.</summary>
public sealed record AppleSubscriptionSnapshot(AppleSubscriptionStatus Status, AppleTransaction Transaction, AppleRenewalInfo? Renewal);

/// <summary>A verified App Store Server Notification V2 payload reduced to what reconciliation needs. The signed payload itself is never kept.</summary>
public sealed record AppleNotification(
    string NotificationUuid,
    string NotificationType,
    string? Subtype,
    AppleEnvironment Environment,
    string BundleId,
    AppleTransaction? Transaction);

/// <summary>The store could not be reached, refused our credential, or throttled us: retry later.</summary>
public sealed class AppleUnavailableException(string message) : Exception(message);

/// <summary>Apple answered with something that is not a well-formed, verifiable response.</summary>
public sealed class AppleMalformedException(string message) : Exception(message);

/// <summary>Apple does not know this original transaction (in that environment).</summary>
public sealed class AppleTransactionNotFoundException() : Exception("The App Store does not know this transaction.");

/// <summary>A signed payload that does not verify: wrong certificate chain, wrong signature or algorithm, or not a JWS at all.</summary>
public sealed class AppleSignatureException(string message) : Exception(message);

/// <summary>What the app needs to start an App Store purchase. Only non-secret, non-price data; the price comes from the App Store itself.</summary>
public sealed record AppleCatalog(bool Enabled, IReadOnlyList<string> ProductIds, Guid? AppAccountToken);

public sealed record AppleVerifyResult(GoogleVerifyOutcome Outcome, StorePurchaseState State);

public enum AppleRestoreOutcome
{
    Restored,
    NothingFound,
    BelongsToAnotherJupleAccount,
    TemporaryFailure,
}

public sealed record AppleRestoreResult(AppleRestoreOutcome Outcome);
