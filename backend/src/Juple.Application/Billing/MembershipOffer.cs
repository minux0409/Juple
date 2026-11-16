namespace Juple.Application.Billing;

/// <summary>
/// Whether the membership purchase is offered to an account. Three different policies used to hang on one switch; only the first is decided
/// here:
/// <list type="number">
/// <item>offering the purchase (the Membership screen and the store catalogs) - this policy: everyone once the program is launched, and
/// before that only the accounts in <see cref="BillingOptions.PurchasePreviewUserIds"/> (App Review, internal testers);</item>
/// <item>starting existing members' free 30 days - <see cref="BillingOptions.ProgramEnabled"/> with <see cref="BillingOptions.ProgramStartAtUtc"/>
/// (Juple.Domain TrialPolicy), never touched by a preview;</item>
/// <item>the read-only restriction after access ended - <see cref="BillingOptions.ProgramEnabled"/> (the write gate), never touched by a preview.</item>
/// </list>
/// A store's own switch (<c>Billing:Apple:Enabled</c>, <c>Billing:Google:Enabled</c>) still has to be on for its catalog to answer "enabled".
/// </summary>
public static class MembershipOffer
{
    public static bool IsOffered(BillingOptions options, long userId) =>
        options.ProgramEnabled || options.PurchasePreviewUserIds.Contains(userId);
}
