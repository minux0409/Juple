using Juple.Domain.Billing;

namespace Juple.Application.Billing.GooglePlay;

/// <summary>Google's SubscriptionPurchaseV2 subscription states, one-to-one (SUBSCRIPTION_STATE_*). Never leaves the Google adapter / normalizer.</summary>
public enum GoogleSubscriptionState
{
    Pending,
    Active,
    Paused,
    InGracePeriod,
    OnHold,
    Canceled,
    Expired,
    PendingPurchaseCanceled,
}

/// <summary>Who ended the subscription, from canceledStateContext. Only used to explain an expiry, never to grant access.</summary>
public enum GoogleCancelSource
{
    None,
    User,
    System,
    Developer,
    Replaced,
}

public enum GooglePlanType
{
    AutoRenewing,
    Prepaid,
}

/// <summary>
/// The parts of an authoritative <c>purchases.subscriptionsv2.get</c> response Juple uses, already picked from the line item
/// of the allowlisted product. Times are UTC instants. Produced only by the Google adapter from the official client types.
/// </summary>
public sealed record GoogleSubscriptionSnapshot(
    GoogleSubscriptionState State,
    string ProductId,
    string? BasePlanId,
    GooglePlanType PlanType,
    DateTimeOffset? StartTimeUtc,
    DateTimeOffset? ExpiryTimeUtc,
    bool AutoRenewing,
    bool AcknowledgementPending,
    string? ObfuscatedAccountId,
    string? LinkedPurchaseToken,
    GoogleCancelSource CancelSource,
    bool IsTestPurchase);

public interface IGooglePlayClient
{
    /// <summary>
    /// <c>purchases.subscriptionsv2.get</c>: Google's current, authoritative state of one purchase. Throws
    /// <see cref="GooglePlayPurchaseNotFoundException"/> (an unknown/invalid token), <see cref="GooglePlayUnavailableException"/>
    /// (timeouts, 5xx, throttling - retryable) or <see cref="GooglePlayMalformedResponseException"/>.
    /// </summary>
    Task<GoogleSubscriptionSnapshot> GetSubscriptionAsync(string packageName, string purchaseToken, string expectedProductId, CancellationToken cancellationToken = default);

    /// <summary>Acknowledges a purchase (idempotent: an already-acknowledged purchase is success).</summary>
    Task AcknowledgeAsync(string packageName, string productId, string purchaseToken, CancellationToken cancellationToken = default);
}

public sealed class GooglePlayPurchaseNotFoundException() : Exception("Google Play does not know this purchase token.");

public sealed class GooglePlayUnavailableException(string message, Exception? inner = null) : Exception(message, inner);

public sealed class GooglePlayMalformedResponseException(string message) : Exception(message);
