namespace Juple.Domain.Billing;

/// <summary>What the store subscription of an account is right now - independent of whether Juple REQUIRES one (the program switch).</summary>
public enum StoreSubscriptionState
{
    /// <summary>No store subscription currently grants anything (never bought, ended, refunded, on hold, pending).</summary>
    None,

    /// <summary>A verified store subscription is current (it may be set to end at the period end: see AutoRenewing).</summary>
    Active,

    /// <summary>A renewal payment failed but the store still grants the subscription while it retries.</summary>
    GracePeriod,
}

/// <summary>One store purchase as ownership needs it: where, which product, what the store last said, until when.</summary>
public sealed record OwnedStorePurchase(StoreSource Source, string ProductId, StorePurchaseState State, DateTimeOffset? AccessEndsAtUtc, bool? AutoRenews)
{
    public bool IsLiveAt(DateTimeOffset nowUtc) =>
        State is StorePurchaseState.Active or StorePurchaseState.GracePeriod or StorePurchaseState.Canceled
        && AccessEndsAtUtc is { } end
        && nowUtc < end;
}

/// <summary>
/// STORE SUBSCRIPTION OWNERSHIP: "does this Juple account currently own a verified store subscription?" - a different question from
/// <see cref="Entitlement"/> ("does Juple currently require / grant access?"). With the subscription program not launched the entitlement
/// is NotLaunched, yet the account may well own a subscription; this is that fact, computed from the persisted, server-verified purchases
/// and the server clock only. It carries no token, order id, internal id or raw store response.
/// </summary>
public sealed record StoreSubscriptionOwnership(
    StoreSubscriptionState State,
    StoreSource? Source,
    string? ProductId,
    DateTimeOffset? CurrentPeriodEndsAtUtc,
    bool? AutoRenewing)
{
    public static StoreSubscriptionOwnership None { get; } = new(StoreSubscriptionState.None, null, null, null, null);

    /// <summary>The best live purchase: fully paid beats a grace period; among equals the one that lasts longest.</summary>
    public static StoreSubscriptionOwnership From(IEnumerable<OwnedStorePurchase> purchases, DateTimeOffset nowUtc)
    {
        var best = purchases
            .Where(purchase => purchase.IsLiveAt(nowUtc))
            .OrderBy(purchase => purchase.State == StorePurchaseState.GracePeriod ? 1 : 0)
            .ThenByDescending(purchase => purchase.AccessEndsAtUtc)
            .FirstOrDefault();
        if (best is null)
        {
            return None;
        }

        return new StoreSubscriptionOwnership(
            best.State == StorePurchaseState.GracePeriod ? StoreSubscriptionState.GracePeriod : StoreSubscriptionState.Active,
            best.Source,
            best.ProductId,
            best.AccessEndsAtUtc,
            // A cancelled-but-current subscription is still owned; it just will not renew.
            best.State == StorePurchaseState.Canceled ? false : best.AutoRenews);
    }
}
