using Juple.Domain.Billing;

namespace Juple.Application.Billing;

/// <summary>
/// The effective access of one account: the BEST valid access among the Juple trial and every verified store purchase (Google
/// today, Apple later) - the account is what is entitled, never a device or a store. Pure and clock-free: <c>nowUtc</c> is the
/// server's.
///
///  a live paid purchase                    -> Active (or GracePeriod while only a renewal-payment grace is live); wins over the trial
///  no live purchase, trial still running   -> Trial
///  nothing live                            -> Expired, frozen at the LATEST instant any access ended (trial or paid) - never "now"
/// </summary>
public static class EntitlementCalculator
{
    public static Entitlement Effective(TrialWindow? trial, IReadOnlyCollection<PurchaseAccess> purchases, DateTimeOffset nowUtc)
    {
        var live = purchases.Where(purchase => purchase.IsLiveAt(nowUtc)).ToList();
        if (live.Count > 0)
        {
            // A fully paid state beats a grace period; among equals the one that lasts longest.
            var best = live
                .OrderBy(purchase => purchase.State == StorePurchaseState.GracePeriod ? 1 : 0)
                .ThenByDescending(purchase => purchase.AccessEndsAtUtc)
                .First();
            var status = best.State == StorePurchaseState.GracePeriod ? EntitlementStatus.GracePeriod : EntitlementStatus.Active;
            return Entitlement.Paid(status, best.AccessEndsAtUtc!.Value, best.Reason, trial, nowUtc);
        }

        if (trial is { } window && nowUtc < window.EndsAtUtc)
        {
            return Entitlement.ForTrial(window, nowUtc);
        }

        // Nothing is live: access ended at the latest end among everything that ever granted it.
        var ended = new List<(DateTimeOffset End, EntitlementReason Reason)>();
        foreach (var purchase in purchases)
        {
            if (purchase.AccessEndsAtUtc is { } end && purchase.State is not StorePurchaseState.Pending)
            {
                ended.Add((end, purchase.Reason));
            }
        }

        if (trial is { } expiredTrial)
        {
            ended.Add((expiredTrial.EndsAtUtc, EntitlementReason.None));
        }

        if (ended.Count == 0)
        {
            throw new InvalidOperationException("An enabled program always has a trial window; nothing granted access.");
        }

        var latest = ended.OrderByDescending(entry => entry.End).First();
        return Entitlement.Expired(trial, latest.End, latest.Reason, nowUtc);
    }
}
