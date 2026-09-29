using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Juple.Api.Configuration;
using Juple.Application.Collections.Locking;
using Microsoft.Extensions.Options;

namespace Juple.Api.Collections;

/// <summary>
/// Stateless unlock grants (see ICollectionUnlockTokenProtector), AES-256-GCM authenticated
/// encryption - the same primitive and envelope discipline as PublicCollectionItemPageCursorCodec.
///
/// Key: its own configured secret, CollectionUnlockGrant:EncryptionKey (see
/// CollectionUnlockGrantOptions) - independent of the public cursor key, with no fallback to it -
/// expanded with HKDF-SHA256 under a versioned purpose label. Because the key comes from
/// configuration, not per-process state, every replica issues and validates identical grants and
/// restarts do not invalidate them; rotating it simply invalidates outstanding grants (users
/// re-enter the password).
///
/// Payload (encrypted, so nothing - not even the internal user/share id - is readable by the holder):
/// Collection id, subject kind + id, purpose, version, expiry. A grant is valid only for that exact
/// Collection, that exact subject, that exact purpose (the Collection lock, or the Collection's share
/// password - never one for the other), that exact version (LockVersion, or the share password's
/// PasswordVersion - any set/change/removal bumps it), and until expiry. A grant issued before
/// purposes existed carries none and counts as a Collection lock grant, exactly as it always did. The
/// password itself is never part of it and cannot be derived from it.
/// </summary>
public sealed class CollectionUnlockTokenProtector : ICollectionUnlockTokenProtector
{
    public static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(15);

    private const byte EnvelopeVersion = 1;
    private const int NonceSizeBytes = 12;
    private const int TagSizeBytes = 16;
    private const int MaxTokenLength = 512;
    private static readonly byte[] KeyDerivationInfo = Encoding.ASCII.GetBytes("juple/collection-unlock-grant/v1");
    private static readonly byte[] AssociatedData = Encoding.ASCII.GetBytes("juple.collection-unlock-grant.v1");

    private readonly byte[] _key;

    public CollectionUnlockTokenProtector(IOptions<CollectionUnlockGrantOptions> options)
    {
        var configuredKey = options.Value.EncryptionKey;
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            throw new InvalidOperationException("CollectionUnlockGrant:EncryptionKey must be configured.");
        }

        byte[] inputKeyMaterial;
        try
        {
            inputKeyMaterial = Convert.FromBase64String(configuredKey);
        }
        catch (FormatException exception)
        {
            throw new InvalidOperationException("CollectionUnlockGrant:EncryptionKey must be Base64.", exception);
        }

        if (inputKeyMaterial.Length != 32)
        {
            throw new InvalidOperationException("CollectionUnlockGrant:EncryptionKey must decode to 32 bytes (AES-256).");
        }

        _key = HKDF.DeriveKey(HashAlgorithmName.SHA256, inputKeyMaterial, 32, salt: [], info: KeyDerivationInfo);
    }

    public CollectionUnlockGrant Issue(
        long collectionId,
        CollectionUnlockSubject subject,
        int version,
        DateTimeOffset nowUtc,
        CollectionUnlockPurpose purpose = CollectionUnlockPurpose.CollectionLock)
    {
        var expiresAtUtc = nowUtc + Lifetime;
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(new Payload(
            collectionId, subject.Kind.ToString(), subject.Id, version, expiresAtUtc.ToUnixTimeSeconds(), PurposeCode(purpose)));

        var envelope = new byte[1 + NonceSizeBytes + plaintext.Length + TagSizeBytes];
        envelope[0] = EnvelopeVersion;
        var nonce = envelope.AsSpan(1, NonceSizeBytes);
        RandomNumberGenerator.Fill(nonce);
        using (var aesGcm = new AesGcm(_key, TagSizeBytes))
        {
            aesGcm.Encrypt(
                nonce,
                plaintext,
                envelope.AsSpan(1 + NonceSizeBytes, plaintext.Length),
                envelope.AsSpan(1 + NonceSizeBytes + plaintext.Length, TagSizeBytes),
                AssociatedData);
        }

        return new CollectionUnlockGrant(Base64UrlEncode(envelope), DateTimeOffset.FromUnixTimeSeconds(expiresAtUtc.ToUnixTimeSeconds()));
    }

    public bool IsValid(
        string? token,
        long collectionId,
        CollectionUnlockSubject subject,
        int version,
        DateTimeOffset nowUtc,
        CollectionUnlockPurpose purpose = CollectionUnlockPurpose.CollectionLock)
    {
        if (string.IsNullOrEmpty(token) || token.Length > MaxTokenLength || !TryBase64UrlDecode(token, out var envelope))
        {
            return false;
        }

        if (envelope.Length <= 1 + NonceSizeBytes + TagSizeBytes || envelope[0] != EnvelopeVersion)
        {
            return false;
        }

        var ciphertextLength = envelope.Length - 1 - NonceSizeBytes - TagSizeBytes;
        var plaintext = new byte[ciphertextLength];
        try
        {
            using var aesGcm = new AesGcm(_key, TagSizeBytes);
            aesGcm.Decrypt(
                envelope.AsSpan(1, NonceSizeBytes),
                envelope.AsSpan(1 + NonceSizeBytes, ciphertextLength),
                envelope.AsSpan(1 + NonceSizeBytes + ciphertextLength, TagSizeBytes),
                plaintext,
                AssociatedData);
        }
        catch (CryptographicException)
        {
            return false;
        }

        Payload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<Payload>(plaintext);
        }
        catch (JsonException)
        {
            return false;
        }

        return payload is not null
            && payload.C == collectionId
            && payload.K == subject.Kind.ToString()
            && payload.S == subject.Id
            && payload.V == version
            && (payload.P ?? LockPurposeCode) == PurposeCode(purpose)
            && payload.E > nowUtc.ToUnixTimeSeconds();
    }

    private static string Base64UrlEncode(byte[] bytes) =>
        Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

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

    private const string LockPurposeCode = "l";

    private static string PurposeCode(CollectionUnlockPurpose purpose) => purpose switch
    {
        CollectionUnlockPurpose.CollectionLock => LockPurposeCode,
        CollectionUnlockPurpose.SharePassword => "s",
        _ => throw new ArgumentOutOfRangeException(nameof(purpose)),
    };

    /// <param name="P">Purpose code; absent (null) in grants issued before purposes existed - read as the lock.</param>
    private sealed record Payload(long C, string K, long S, int V, long E, string? P = null);
}
