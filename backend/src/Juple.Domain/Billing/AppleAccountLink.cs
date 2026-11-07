namespace Juple.Domain.Billing;

/// <summary>
/// The App Account Token (a UUID) given to StoreKit for one Juple account (<c>Product.PurchaseOption.appAccountToken</c>), kept so an App
/// Store Server Notification or a reconciliation can resolve "this transaction's appAccountToken" to an account WITHOUT scanning users.
/// It is a keyed hash (see IAppleAccountTokenProvider): not the internal UserId, not an email, not the Juple ID, and not reversible
/// without the key. One per account and unique across accounts. Removed with the account.
/// </summary>
public sealed class AppleAccountLink
{
    private AppleAccountLink()
    {
    }

    public AppleAccountLink(long userId, Guid appAccountToken, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        AppAccountToken = appAccountToken;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid AppAccountToken { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
