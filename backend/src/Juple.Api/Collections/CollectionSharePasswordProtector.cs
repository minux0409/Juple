using System.Security.Cryptography;
using System.Text;
using Juple.Api.Configuration;
using Juple.Application.Collections.SharePassword;
using Microsoft.Extensions.Options;

namespace Juple.Api.Collections;

/// <summary>
/// Seals a Collection's share password with AES-256-GCM (authenticated encryption, the same
/// primitive and envelope discipline as CollectionUnlockTokenProtector) so its Owner can see it
/// again - the only reversible copy; recipients are always checked against the separate slow hash.
///
/// Key: CollectionSharePassword:EncryptionKey (see CollectionSharePasswordOptions), expanded with
/// HKDF-SHA256 under a versioned purpose label. Envelope: format version, key id, random 96-bit
/// nonce, ciphertext, 128-bit tag - Base64url. The Collection id and key id are authenticated as
/// associated data, so a sealed password copied onto another Collection does not open. Anything that
/// does not authenticate - tampered, truncated, sealed under another key or key id - gives null (fail
/// closed). The password is never logged here.
/// </summary>
public sealed class CollectionSharePasswordProtector : ICollectionSharePasswordProtector
{
    private const byte EnvelopeVersion = 1;
    private const int NonceSizeBytes = 12;
    private const int TagSizeBytes = 16;
    private const int HeaderSizeBytes = 2;
    private const int MaxEnvelopeLength = 512;
    private static readonly byte[] KeyDerivationInfo = Encoding.ASCII.GetBytes("juple/collection-share-password/v1");

    private readonly byte[] _key;
    private readonly byte _keyId;

    public CollectionSharePasswordProtector(IOptions<CollectionSharePasswordOptions> options)
    {
        var configuredKey = options.Value.EncryptionKey;
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            throw new InvalidOperationException("CollectionSharePassword:EncryptionKey must be configured.");
        }

        byte[] inputKeyMaterial;
        try
        {
            inputKeyMaterial = Convert.FromBase64String(configuredKey);
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException("CollectionSharePassword:EncryptionKey must be Base64.", exception);
        }

        if (inputKeyMaterial.Length != 32)
        {
            throw new InvalidOperationException("CollectionSharePassword:EncryptionKey must decode to 32 bytes (AES-256).");
        }

        _key = HKDF.DeriveKey(HashAlgorithmName.SHA256, inputKeyMaterial, 32, salt: [], info: KeyDerivationInfo);
        _keyId = options.Value.KeyId;
    }

    public string Protect(long collectionId, string password)
    {
        var plaintext = Encoding.UTF8.GetBytes(password);
        var envelope = new byte[HeaderSizeBytes + NonceSizeBytes + plaintext.Length + TagSizeBytes];
        envelope[0] = EnvelopeVersion;
        envelope[1] = _keyId;
        var nonce = envelope.AsSpan(HeaderSizeBytes, NonceSizeBytes);
        RandomNumberGenerator.Fill(nonce);
        using (var aesGcm = new AesGcm(_key, TagSizeBytes))
        {
            aesGcm.Encrypt(
                nonce,
                plaintext,
                envelope.AsSpan(HeaderSizeBytes + NonceSizeBytes, plaintext.Length),
                envelope.AsSpan(HeaderSizeBytes + NonceSizeBytes + plaintext.Length, TagSizeBytes),
                AssociatedData(collectionId, _keyId));
        }

        CryptographicOperations.ZeroMemory(plaintext);
        return Convert.ToBase64String(envelope).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    public string? Unprotect(long collectionId, string protectedPassword)
    {
        if (string.IsNullOrEmpty(protectedPassword)
            || protectedPassword.Length > MaxEnvelopeLength
            || !TryBase64UrlDecode(protectedPassword, out var envelope))
        {
            return null;
        }

        if (envelope.Length <= HeaderSizeBytes + NonceSizeBytes + TagSizeBytes
            || envelope[0] != EnvelopeVersion
            || envelope[1] != _keyId)
        {
            return null;
        }

        var ciphertextLength = envelope.Length - HeaderSizeBytes - NonceSizeBytes - TagSizeBytes;
        var plaintext = new byte[ciphertextLength];
        try
        {
            using var aesGcm = new AesGcm(_key, TagSizeBytes);
            aesGcm.Decrypt(
                envelope.AsSpan(HeaderSizeBytes, NonceSizeBytes),
                envelope.AsSpan(HeaderSizeBytes + NonceSizeBytes, ciphertextLength),
                envelope.AsSpan(HeaderSizeBytes + NonceSizeBytes + ciphertextLength, TagSizeBytes),
                plaintext,
                AssociatedData(collectionId, envelope[1]));
            return Encoding.UTF8.GetString(plaintext);
        }
        catch (CryptographicException)
        {
            return null;
        }
        finally
        {
            CryptographicOperations.ZeroMemory(plaintext);
        }
    }

    private static byte[] AssociatedData(long collectionId, byte keyId) =>
        Encoding.ASCII.GetBytes($"juple.collection-share-password.v1:{keyId}:{collectionId}");

    private static bool TryBase64UrlDecode(string value, out byte[] bytes)
    {
        bytes = [];
        var base64 = value.Replace('-', '+').Replace('_', '/');
        base64 = (base64.Length % 4) switch
        {
            2 => base64 + "==",
            3 => base64 + "=",
            0 => base64,
            _ => string.Empty,
        };
        if (base64.Length == 0)
        {
            return false;
        }

        try
        {
            bytes = Convert.FromBase64String(base64);
            return true;
        }
        catch (FormatException)
        {
            return false;
        }
    }
}
