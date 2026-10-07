using Juple.Domain.Billing;

namespace Juple.Application.Billing.GooglePlay;

/// <summary>
/// Maps one authoritative Google subscription state onto Juple's store-neutral <see cref="NormalizedPurchase"/> - every state of
/// SubscriptionPurchaseV2 is handled explicitly, and an unknown one is refused rather than guessed.
///
///  PENDING                   no access, not acknowledged (payment is still being completed)
///  ACTIVE                    live until the store's expiry
///  CANCELED                  auto-renew is off but the paid period is not over: live until the store's expiry (reason Cancelled)
///  IN_GRACE_PERIOD           live (reason BillingIssue). Google does not document where the grace period ends in expiryTime,
///                            so access is granted for a short, re-verified horizon (<see cref="GraceVerificationHorizon"/>)
///                            and the purchase is re-checked every few hours - never open-ended
///  ON_HOLD                   not live (BillingIssue): payment failed beyond grace
///  PAUSED                    not live (Paused): the user paused it
///  EXPIRED                   not live; reason from who ended it (a user cancel, the system - payment problems -, a developer
///                            revoke/refund, or a replacement by another purchase)
///  PENDING_PURCHASE_CANCELED not live, never granted
/// </summary>
public static class GooglePurchaseNormalizer
{
    public static readonly TimeSpan GraceVerificationHorizon = TimeSpan.FromHours(24);

    public static readonly TimeSpan MaxReconcileInterval = TimeSpan.FromHours(24);

    public static readonly TimeSpan GraceReconcileInterval = TimeSpan.FromHours(6);

    public static readonly TimeSpan PendingReconcileInterval = TimeSpan.FromHours(1);

    private static readonly TimeSpan RenewalSettleDelay = TimeSpan.FromMinutes(10);

    private static readonly TimeSpan MinReconcileInterval = TimeSpan.FromMinutes(5);

    public static NormalizedPurchase Normalize(GoogleSubscriptionSnapshot snapshot, DateTimeOffset nowUtc)
    {
        if (snapshot.PlanType != GooglePlanType.AutoRenewing)
        {
            throw new GooglePlayMalformedResponseException("Only an auto-renewing plan is supported.");
        }

        var ackPending = snapshot.AcknowledgementPending;
        switch (snapshot.State)
        {
            case GoogleSubscriptionState.Pending:
                return new(StorePurchaseState.Pending, EntitlementReason.None, null, snapshot.AutoRenewing, AcknowledgementPending: false, nowUtc + PendingReconcileInterval);

            case GoogleSubscriptionState.PendingPurchaseCanceled:
                return new(StorePurchaseState.Expired, EntitlementReason.None, null, snapshot.AutoRenewing, AcknowledgementPending: false, nowUtc + MaxReconcileInterval);

            case GoogleSubscriptionState.Active:
                return new(StorePurchaseState.Active, EntitlementReason.None, RequireExpiry(snapshot), snapshot.AutoRenewing, ackPending, NextAroundExpiry(snapshot, nowUtc));

            case GoogleSubscriptionState.Canceled:
                return new(StorePurchaseState.Canceled, EntitlementReason.Cancelled, RequireExpiry(snapshot), snapshot.AutoRenewing, ackPending, NextAroundExpiry(snapshot, nowUtc));

            case GoogleSubscriptionState.InGracePeriod:
            {
                var expiry = RequireExpiry(snapshot);
                var horizon = nowUtc + GraceVerificationHorizon;
                return new(StorePurchaseState.GracePeriod, EntitlementReason.BillingIssue, expiry > horizon ? expiry : horizon, snapshot.AutoRenewing, ackPending, nowUtc + GraceReconcileInterval);
            }

            case GoogleSubscriptionState.OnHold:
                return new(StorePurchaseState.OnHold, EntitlementReason.BillingIssue, EndedAt(snapshot, nowUtc), snapshot.AutoRenewing, ackPending, nowUtc + MaxReconcileInterval);

            case GoogleSubscriptionState.Paused:
                return new(StorePurchaseState.Paused, EntitlementReason.Paused, EndedAt(snapshot, nowUtc), snapshot.AutoRenewing, ackPending, nowUtc + MaxReconcileInterval);

            case GoogleSubscriptionState.Expired:
            {
                var (state, reason) = snapshot.CancelSource switch
                {
                    GoogleCancelSource.Developer => (StorePurchaseState.Revoked, EntitlementReason.Refunded),
                    GoogleCancelSource.System => (StorePurchaseState.Expired, EntitlementReason.BillingIssue),
                    GoogleCancelSource.User => (StorePurchaseState.Expired, EntitlementReason.Cancelled),
                    _ => (StorePurchaseState.Expired, EntitlementReason.None),
                };
                // An expired purchase does not need re-polling often: a re-subscription arrives as a NEW token.
                return new(state, reason, EndedAt(snapshot, nowUtc), snapshot.AutoRenewing, AcknowledgementPending: false, nowUtc + MaxReconcileInterval);
            }

            default:
                throw new GooglePlayMalformedResponseException("Unknown Google subscription state.");
        }
    }

    private static DateTimeOffset RequireExpiry(GoogleSubscriptionSnapshot snapshot) =>
        snapshot.ExpiryTimeUtc ?? throw new GooglePlayMalformedResponseException("A live subscription state carried no expiry time.");

    /// <summary>When access ended: the store's expiry, but never later than the moment we learned of it (a revoke has a future expiry).</summary>
    private static DateTimeOffset EndedAt(GoogleSubscriptionSnapshot snapshot, DateTimeOffset nowUtc) =>
        snapshot.ExpiryTimeUtc is { } expiry && expiry < nowUtc ? expiry : nowUtc;

    /// <summary>Re-check shortly after the paid period ends (to catch the renewal), and at least daily.</summary>
    private static DateTimeOffset NextAroundExpiry(GoogleSubscriptionSnapshot snapshot, DateTimeOffset nowUtc)
    {
        var daily = nowUtc + MaxReconcileInterval;
        var expiry = snapshot.ExpiryTimeUtc;
        if (expiry is null)
        {
            return daily;
        }

        var afterExpiry = expiry.Value + RenewalSettleDelay;
        var earliest = nowUtc + MinReconcileInterval;
        var candidate = afterExpiry < daily ? afterExpiry : daily;
        return candidate < earliest ? earliest : candidate;
    }
}
