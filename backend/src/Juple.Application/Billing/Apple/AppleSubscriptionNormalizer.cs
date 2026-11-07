using Juple.Domain.Billing;

namespace Juple.Application.Billing.Apple;

/// <summary>
/// Maps one authoritative App Store subscription status (App Store Server API "Get All Subscription Statuses") onto Juple's store-neutral
/// <see cref="NormalizedPurchase"/>. Every status is handled explicitly; an unknown one is refused rather than guessed.
///
///  1 Active              live until the expiry; if the renewal info says auto-renew is OFF it is Canceled (still live to the expiry)
///  2 Expired             not live; the reason comes from the renewal info's expiration intent (1 the person cancelled, 2 billing
///                        problem, 3 declined a price increase, 4 product unavailable, 5 other)
///  3 Billing retry       not live (the paid period ended and Apple is retrying the charge): OnHold, BillingIssue
///  4 Billing grace       live (BillingIssue) until the grace period Apple itself reports - unlike Google, Apple documents the end
///  5 Revoked             refunded / family sharing removed: not live from the revocation
/// </summary>
public static class AppleSubscriptionNormalizer
{
    public static readonly TimeSpan MaxReconcileInterval = TimeSpan.FromHours(24);

    public static readonly TimeSpan GraceReconcileInterval = TimeSpan.FromHours(6);

    private static readonly TimeSpan RenewalSettleDelay = TimeSpan.FromMinutes(10);

    private static readonly TimeSpan MinReconcileInterval = TimeSpan.FromMinutes(5);

    public static NormalizedPurchase Normalize(AppleSubscriptionSnapshot snapshot, DateTimeOffset nowUtc)
    {
        var transaction = snapshot.Transaction;
        var autoRenews = snapshot.Renewal?.AutoRenews;

        // A revocation date always wins: whatever the status says, a refunded purchase is not access.
        if (snapshot.Status == AppleSubscriptionStatus.Revoked || transaction.RevocationDateUtc is not null)
        {
            return new(StorePurchaseState.Revoked, EntitlementReason.Refunded, EndedAt(transaction.RevocationDateUtc, transaction.ExpiresDateUtc, nowUtc), autoRenews, AcknowledgementPending: false, nowUtc + MaxReconcileInterval);
        }

        switch (snapshot.Status)
        {
            case AppleSubscriptionStatus.Active when autoRenews == false:
                return new(StorePurchaseState.Canceled, EntitlementReason.Cancelled, RequireExpiry(transaction), autoRenews, false, NextAroundExpiry(transaction.ExpiresDateUtc, nowUtc));

            case AppleSubscriptionStatus.Active:
                return new(StorePurchaseState.Active, EntitlementReason.None, RequireExpiry(transaction), autoRenews, false, NextAroundExpiry(transaction.ExpiresDateUtc, nowUtc));

            case AppleSubscriptionStatus.BillingGracePeriod:
            {
                // Apple documents the end of the grace period; without it the paid expiry is all that can be relied on.
                var graceEnd = snapshot.Renewal?.GracePeriodExpiresDateUtc ?? RequireExpiry(transaction);
                var accessEnd = graceEnd > RequireExpiry(transaction) ? graceEnd : RequireExpiry(transaction);
                return new(StorePurchaseState.GracePeriod, EntitlementReason.BillingIssue, accessEnd, autoRenews, false, nowUtc + GraceReconcileInterval);
            }

            case AppleSubscriptionStatus.BillingRetry:
                return new(StorePurchaseState.OnHold, EntitlementReason.BillingIssue, EndedAt(null, transaction.ExpiresDateUtc, nowUtc), autoRenews, false, nowUtc + GraceReconcileInterval);

            case AppleSubscriptionStatus.Expired:
            {
                var reason = snapshot.Renewal?.ExpirationIntent switch
                {
                    1 => EntitlementReason.Cancelled,
                    2 => EntitlementReason.BillingIssue,
                    _ => EntitlementReason.None,
                };
                // An expired subscription needs no frequent re-check: a re-subscription arrives as a new status of the same original
                // transaction, and Apple notifies it - the daily sweep is the safety net.
                return new(StorePurchaseState.Expired, reason, EndedAt(null, transaction.ExpiresDateUtc, nowUtc), autoRenews, false, nowUtc + MaxReconcileInterval);
            }

            default:
                throw new AppleMalformedException("Unknown App Store subscription status.");
        }
    }

    private static DateTimeOffset RequireExpiry(AppleTransaction transaction) =>
        transaction.ExpiresDateUtc ?? throw new AppleMalformedException("A live subscription status carried no expiry date.");

    /// <summary>When access ended: the revocation or the store expiry, but never later than the moment we learned of it.</summary>
    private static DateTimeOffset EndedAt(DateTimeOffset? revocation, DateTimeOffset? expires, DateTimeOffset nowUtc)
    {
        var candidate = revocation ?? expires;
        return candidate is { } instant && instant < nowUtc ? instant : nowUtc;
    }

    /// <summary>Re-check shortly after the paid period ends (to catch the renewal), and at least daily.</summary>
    private static DateTimeOffset NextAroundExpiry(DateTimeOffset? expiry, DateTimeOffset nowUtc)
    {
        var daily = nowUtc + MaxReconcileInterval;
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
