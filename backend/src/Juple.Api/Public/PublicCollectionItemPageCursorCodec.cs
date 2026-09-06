using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Microsoft.Extensions.Options;

namespace Juple.Api.Public;

public interface IPublicCollectionItemPageCursorCodec
{
    string Encode(string publicId, CollectionItemPageCursor cursor);

    bool TryDecode(string publicId, string value, out CollectionItemPageCursor? cursor);
}

/// <summary>
/// AES-256-GCM-encrypts the public `cursor` query value for
/// GET /api/v1/public/collections/{publicId}/items - unlike the authenticated
/// CollectionItemPageCursorCodec (plain Base64url/JSON), this cursor crosses the anonymous
/// boundary, so its payload (ItemId, AddedAtUtc) must not be readable by whoever holds it, not just
/// tamper-evident. The Collection's publicId is bound in as AEAD associated data, so a cursor
/// minted for one share can never be decrypted against another share's items endpoint - defense in
/// depth on top of the fact that PublicCollectionStore.GetItemsAsync already scopes every query by
/// the Collection resolved from publicId, independent of anything the cursor carries.
///
/// Wire envelope (before Base64url): [envelope version (1 byte)][nonce (12 bytes)][ciphertext (N
/// bytes)][auth tag (16 bytes)]. The envelope version is checked before any AES-GCM call is
/// attempted, so a future change to the scheme itself (algorithm, nonce size) can be recognized and
/// rejected outright rather than fed into Decrypt with the wrong size assumptions.
///
/// The key comes from plain configuration (see PublicCollectionCursorOptions), not ASP.NET Core
/// Data Protection: Data Protection's auto-generated keys are not shared across replicas or
/// restarts unless a persisted key ring is wired up, which would invalidate in-flight cursors on
/// every scale/deploy event - an operational cost this feature does not need. A single configured
/// key behaves identically on every instance and across restarts; losing or rotating it only makes
/// existing "load more" cursors decode as invalid (the Viewer simply has nothing further to load),
/// never a data-loss or availability incident.
/// </summary>
public sealed class PublicCollectionItemPageCursorCodec : IPublicCollectionItemPageCursorCodec
{
    // Governs the wire envelope itself (nonce/tag sizes, algorithm) - checked before any AES-GCM
    // call is attempted, so an unrecognized envelope is rejected outright rather than fed into
    // Decrypt with the wrong size assumptions. Distinct from CursorPayload.V, which versions the
    // JSON schema of the plaintext this envelope happens to carry.
    private const byte CurrentEnvelopeVersion = 1;
    private const int CurrentVersion = 1;
    private const int NonceSizeBytes = 12;
    private const int TagSizeBytes = 16;

    private readonly byte[] _key;

    public PublicCollectionItemPageCursorCodec(IOptions<PublicCollectionCursorOptions> options)
    {
        var configuredKey = options.Value.EncryptionKey;
        if (string.IsNullOrWhiteSpace(configuredKey))
        {
            throw new InvalidOperationException("PublicCollectionCursor:EncryptionKey must be configured.");
        }

        _key = Convert.FromBase64String(configuredKey);
        if (_key.Length != 32)
        {
            throw new InvalidOperationException(
                "PublicCollectionCursor:EncryptionKey must decode to 32 bytes (AES-256).");
        }
    }

    public string Encode(string publicId, CollectionItemPageCursor cursor)
    {
        var plaintext = JsonSerializer.SerializeToUtf8Bytes(
            new CursorPayload(CurrentVersion, cursor.AddedAtUtc, cursor.ItemId));

        var nonce = RandomNumberGenerator.GetBytes(NonceSizeBytes);
        var ciphertext = new byte[plaintext.Length];
        var tag = new byte[TagSizeBytes];

        using (var aesGcm = new AesGcm(_key, TagSizeBytes))
        {
            aesGcm.Encrypt(nonce, plaintext, ciphertext, tag, AssociatedData(publicId));
        }

        var wire = new byte[1 + nonce.Length + ciphertext.Length + tag.Length];
        wire[0] = CurrentEnvelopeVersion;
        Buffer.BlockCopy(nonce, 0, wire, 1, nonce.Length);
        Buffer.BlockCopy(ciphertext, 0, wire, 1 + nonce.Length, ciphertext.Length);
        Buffer.BlockCopy(tag, 0, wire, 1 + nonce.Length + ciphertext.Length, tag.Length);

        return Convert.ToBase64String(wire)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }

    public bool TryDecode(string publicId, string value, out CollectionItemPageCursor? cursor)
    {
        cursor = null;

        try
        {
            var base64 = value.Replace('-', '+').Replace('_', '/');
            var paddingNeeded = (4 - (base64.Length % 4)) % 4;
            base64 = base64.PadRight(base64.Length + paddingNeeded, '=');

            var wire = Convert.FromBase64String(base64);
            if (wire.Length <= 1 + NonceSizeBytes + TagSizeBytes || wire[0] != CurrentEnvelopeVersion)
            {
                return false;
            }

            var nonce = wire.AsSpan(1, NonceSizeBytes);
            var ciphertextLength = wire.Length - 1 - NonceSizeBytes - TagSizeBytes;
            var ciphertext = wire.AsSpan(1 + NonceSizeBytes, ciphertextLength);
            var tag = wire.AsSpan(1 + NonceSizeBytes + ciphertextLength, TagSizeBytes);

            var plaintext = new byte[ciphertextLength];

            using (var aesGcm = new AesGcm(_key, TagSizeBytes))
            {
                aesGcm.Decrypt(nonce, ciphertext, tag, plaintext, AssociatedData(publicId));
            }

            var payload = JsonSerializer.Deserialize<CursorPayload>(plaintext);
            if (payload is null || payload.V != CurrentVersion || payload.ItemId <= 0)
            {
                return false;
            }

            cursor = new CollectionItemPageCursor(payload.T, payload.ItemId);
            return true;
        }
        catch (Exception exception) when (
            exception is FormatException or JsonException or ArgumentException or CryptographicException)
        {
            return false;
        }
    }

    private static byte[] AssociatedData(string publicId) => Encoding.UTF8.GetBytes(publicId);

    private sealed record CursorPayload(int V, DateTimeOffset T, long ItemId);
}
