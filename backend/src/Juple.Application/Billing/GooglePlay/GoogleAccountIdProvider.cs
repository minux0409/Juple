using System.Security.Cryptography;
using System.Text;

namespace Juple.Application.Billing.GooglePlay;

public interface IGoogleAccountIdProvider
{
    /// <summary>The opaque, stable id for this account that is given to Google (and comes back on every purchase of it).</summary>
    string Compute(long userId);
}

/// <summary>
/// <c>Base64Url(HMAC-SHA256(Billing:Google:AccountHashKey, "juple-google-account-v1|" + userId))</c> - 43 characters (Google allows
/// up to 64), deterministic per account, not the internal UserId, not reversible without the key, and different for every account.
/// </summary>
public sealed class GoogleAccountIdProvider(BillingOptions options) : IGoogleAccountIdProvider
{
    public const string DomainPrefix = "juple-google-account-v1";

    public string Compute(long userId)
    {
        if (!TrialIdentityHasher.TryDecodeKey(options.Google.AccountHashKey, out var key))
        {
            throw new InvalidOperationException("Billing:Google:AccountHashKey is not configured.");
        }

        var mac = HMACSHA256.HashData(key, Encoding.UTF8.GetBytes($"{DomainPrefix}|{userId}"));
        return Convert.ToBase64String(mac).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }
}
