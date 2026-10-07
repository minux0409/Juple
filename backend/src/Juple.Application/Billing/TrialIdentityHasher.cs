using System.Security.Cryptography;
using System.Text;
using Juple.Application.Identity;

namespace Juple.Application.Billing;

public interface ITrialIdentityHasher
{
    /// <summary>The 32-byte keyed hash of an external identity - the only form in which it is ever stored for the trial ledger.</summary>
    byte[] Hash(ExternalIdentityPrincipal externalIdentity);
}

/// <summary>
/// HMAC-SHA256(key, "juple-trial-v1|" + tenantId + "|" + objectId), the ids in lowercase hyphenated "D" form. The fixed
/// domain-separation prefix keeps this key's output from ever being valid for any other purpose; the key is the
/// <see cref="BillingOptions.TrialIdentityHashKey"/> secret. Deterministic for one identity, different for any other.
/// Lookups compare the stored hash in SQL (a unique index), never a secret-dependent branch in application code; callers
/// that compare two hashes in memory use <see cref="Equal"/> (constant time).
/// </summary>
public sealed class TrialIdentityHasher(BillingOptions options) : ITrialIdentityHasher
{
    public const string DomainPrefix = "juple-trial-v1";

    public byte[] Hash(ExternalIdentityPrincipal externalIdentity)
    {
        if (!TryDecodeKey(options.TrialIdentityHashKey, out var key))
        {
            throw new InvalidOperationException("Billing:TrialIdentityHashKey is not configured.");
        }

        var canonical = $"{DomainPrefix}|{externalIdentity.TenantId:D}|{externalIdentity.ObjectId:D}";
        return HMACSHA256.HashData(key, Encoding.UTF8.GetBytes(canonical));
    }

    public static bool Equal(ReadOnlySpan<byte> left, ReadOnlySpan<byte> right) =>
        CryptographicOperations.FixedTimeEquals(left, right);

    internal static bool TryDecodeKey(string? value, out byte[] key)
    {
        key = [];
        if (string.IsNullOrWhiteSpace(value))
        {
            return false;
        }

        try
        {
            var decoded = Convert.FromBase64String(value);
            if (decoded.Length < BillingOptions.MinimumHashKeyBytes)
            {
                return false;
            }

            key = decoded;
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
