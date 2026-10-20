namespace Juple.Application.Billing;

/// <summary>Business reference only. Never a checkout price: that always comes from the store's localized product metadata.</summary>
public static class SubscriptionPricingPolicy
{
    public const decimal MonthlyUsdReferencePrice = 1.99m;
    public const string ReferenceCurrency = "USD";
    public const string BillingPeriod = "P1M";
    public const int TrialDays = Juple.Domain.Billing.TrialPolicy.DurationDays;
}
