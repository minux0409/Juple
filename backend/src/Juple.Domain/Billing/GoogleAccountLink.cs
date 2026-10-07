namespace Juple.Domain.Billing;

/// <summary>
/// The opaque account identifier given to Google Play for one Juple account (BillingFlowParams.setObfuscatedAccountId), kept so
/// a notification or reconciliation can resolve "this purchase's obfuscated account id" to an account WITHOUT scanning users.
/// It is a keyed hash (see IGoogleAccountIdProvider): not the internal UserId, not an email, not the Juple ID, and not
/// reversible without the key. One per account and unique across accounts. Removed with the account.
/// </summary>
public sealed class GoogleAccountLink
{
    private GoogleAccountLink()
    {
    }

    public GoogleAccountLink(long userId, string accountKey, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        AccountKey = accountKey;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    /// <summary>Base64Url of the 32-byte HMAC (43 characters; Google allows up to 64).</summary>
    public string AccountKey { get; private set; } = null!;

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
