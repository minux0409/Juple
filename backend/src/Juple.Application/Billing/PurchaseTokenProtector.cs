using System.Security.Cryptography;
using System.Text;

namespace Juple.Application.Billing;

public interface IPurchaseTokenProtector
{
    /// <summary>Seals a store purchase handle for storage. A fresh nonce each call: the same token seals differently every time.</summary>
    byte[] Seal(string purchaseToken);

    /// <summary>Opens a sealed handle. Throws <see cref="PurchaseTokenTamperedException"/> for anything not produced by <see cref="Seal"/> under this key.</summary>
    string Open(byte[] sealedToken);

    /// <summary>SHA-256 of the token: the lookup/uniqueness identity (never reversible to the token).</summary>
    byte[] Hash(string purchaseToken);
}

public sealed class PurchaseTokenTamperedException() : Exception("The sealed purchase handle could not be opened.");

/// <summary>
/// AES-256-GCM under the dedicated <c>Billing:Google:PurchaseTokenEncryptionKey</c> (never the share-password, Collection or
/// trial keys). Packed as <c>version(1) | nonce(12) | tag(16) | ciphertext</c>, with the version and a fixed purpose string
/// authenticated, so a blob cannot be altered, truncated or reused for another purpose without detection.
/// </summary>
public sealed class PurchaseTokenProtector(BillingOptions options) : IPurchaseTokenProtector
{
    private const byte Version = 1;
    private const int NonceLength = 12;
    private const int TagLength = 16;
    private static readonly byte[] AssociatedData = Encoding.UTF8.GetBytes("juple-billing-purchase-token-v1");

    public byte[] Seal(string purchaseToken)
    {
        var key = RequireKey();
        var plaintext = Encoding.UTF8.GetBytes(purchaseToken);
        var packed = new byte[1 + NonceLength + TagLength + plaintext.Length];
        packed[0] = Version;
        var nonce = packed.AsSpan(1, NonceLength);
        RandomNumberGenerator.Fill(nonce);
        var tag = packed.AsSpan(1 + NonceLength, TagLength);
        var ciphertext = packed.AsSpan(1 + NonceLength + TagLength);
        using var aes = new AesGcm(key, TagLength);
        aes.Encrypt(nonce, plaintext, ciphertext, tag, AssociatedData);
        return packed;
    }

    public string Open(byte[] sealedToken)
    {
        var key = RequireKey();
        if (sealedToken.Length <= 1 + NonceLength + TagLength || sealedToken[0] != Version)
        {
            throw new PurchaseTokenTamperedException();
        }

        var nonce = sealedToken.AsSpan(1, NonceLength);
        var tag = sealedToken.AsSpan(1 + NonceLength, TagLength);
        var ciphertext = sealedToken.AsSpan(1 + NonceLength + TagLength);
        var plaintext = new byte[ciphertext.Length];
        try
        {
            using var aes = new AesGcm(key, TagLength);
            aes.Decrypt(nonce, ciphertext, tag, plaintext, AssociatedData);
        }
        catch (CryptographicException)
        {
            throw new PurchaseTokenTamperedException();
        }

        return Encoding.UTF8.GetString(plaintext);
    }

    public byte[] Hash(string purchaseToken) => SHA256.HashData(Encoding.UTF8.GetBytes(purchaseToken));

    private byte[] RequireKey() =>
        TryDecodeKey(options.Google.PurchaseTokenEncryptionKey, out var key)
            ? key
            : throw new InvalidOperationException("Billing:Google:PurchaseTokenEncryptionKey is not configured.");

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
            if (decoded.Length != 32)
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
