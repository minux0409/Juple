using System.Security.Cryptography;
using System.Text;
using Juple.Application.Identity;

namespace Juple.Application.Billing;

public interface ITrialIdentityHasher
{
    /// <summary>The 32-byte keyed hash of an external identity - the only form in which it is ever stored for the trial ledger.</summary>
    byte[] Hash(ExternalIdentityPrincipal externalIdentity);

    /// <summary>
    /// The 32-byte keyed hash of a sign-in email address, or null when the hashing key is not configured (the subscription program is
    /// off) or the address is empty. The Entra object id changes when the same person deletes their account and signs up again;
    /// the email does not, so this is what lets a returning person be recognised without ever storing the address itself.
    /// </summary>
    byte[]? HashEmail(string? email);
}

/// <summary>Remembers / re-applies the free-trial window under the keyed email hash (see <see cref="ITrialIdentityHasher.HashEmail"/>).</summary>
public interface ITrialEmailLedger
{
    /// <summary>
    /// For a brand-new account (named by its external identity): when the email hash is already in the ledger, the account gets that ORIGINAL window instead of a
    /// fresh one. A no-op when the hash is unknown or the account already has a window.
    /// </summary>
    Task InheritAsync(ExternalIdentityPrincipal identity, byte[] emailHash, CancellationToken cancellationToken = default);
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

    public const string EmailDomainPrefix = "juple-trial-email-v1";

    public byte[]? HashEmail(string? email)
    {
        if (string.IsNullOrWhiteSpace(email) || !TryDecodeKey(options.TrialIdentityHashKey, out var key))
        {
            return null;
        }

        // Case-insensitive and trimmed - nothing smarter (no plus-address or dot folding): an address is what the person typed.
        var canonical = $"{EmailDomainPrefix}|{email.Trim().ToLowerInvariant()}";
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
