using System.Text;
using Juple.Api.Configuration;
using Juple.Api.Public;
using Juple.Application.Collections;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Collections;

public sealed class PublicCollectionItemPageCursorCodecTests
{
    private const string PublicId = "abc123";
    private const string OtherPublicId = "zzz999";

    private static PublicCollectionItemPageCursorCodec CreateCodec(string? key = null)
    {
        var options = Options.Create(new PublicCollectionCursorOptions
        {
            EncryptionKey = key ?? Convert.ToBase64String(new byte[32]),
        });
        return new PublicCollectionItemPageCursorCodec(options);
    }

    [Fact]
    public void EncodeThenTryDecode_WithSamePublicId_RoundTripsToTheSameCursor()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero), 123);

        var encoded = codec.Encode(PublicId, cursor);
        var decoded = codec.TryDecode(PublicId, encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void EncodeThenTryDecode_WithAFreshInstanceOnTheSamePersistentKey_StillDecodes()
    {
        // Simulates a server restart/new revision: the key comes from configuration, not anything
        // held in the codec's own memory, so a brand new instance built from the same configured
        // key must decode a cursor minted by a since-recycled instance.
        var persistentKey = Convert.ToBase64String(Enumerable.Repeat((byte)7, 32).ToArray());
        var beforeRestart = CreateCodec(persistentKey);
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero), 123);
        var encoded = beforeRestart.Encode(PublicId, cursor);

        var afterRestart = CreateCodec(persistentKey);
        var decoded = afterRestart.TryDecode(PublicId, encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void EncodeThenTryDecode_PreservesOrderingSemanticsForTiedAddedAtUtc()
    {
        var codec = CreateCodec();
        var addedAtUtc = new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero);
        var earlierCursor = new CollectionItemPageCursor(addedAtUtc, 100);
        var laterCursor = new CollectionItemPageCursor(addedAtUtc, 200);

        codec.TryDecode(PublicId, codec.Encode(PublicId, earlierCursor), out var decodedEarlier);
        codec.TryDecode(PublicId, codec.Encode(PublicId, laterCursor), out var decodedLater);

        // PublicCollectionStore's keyset pagination breaks AddedAtUtc ties by ItemId - the codec
        // must round-trip both fields exactly, or two items added in the same instant could be
        // skipped or repeated across pages.
        Assert.Equal(earlierCursor, decodedEarlier);
        Assert.Equal(laterCursor, decodedLater);
        Assert.Equal(decodedEarlier!.AddedAtUtc, decodedLater!.AddedAtUtc);
        Assert.True(decodedEarlier.ItemId < decodedLater.ItemId);
    }

    [Fact]
    public void Encode_DoesNotContainThePlaintextItemIdAsText()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero), 123456789);

        var encoded = codec.Encode(PublicId, cursor);

        Assert.DoesNotContain("123456789", encoded);
    }

    [Fact]
    public void Encode_Base64UrlDecodedRawBytesDoNotContainThePlaintextItemIdEither()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero), 123456789);

        var encoded = codec.Encode(PublicId, cursor);

        // Undo only the Base64url layer (exactly what any caller can trivially do without the
        // key) and confirm the raw envelope bytes are opaque ciphertext, not a differently-shaped
        // text encoding of the same plaintext fields - unlike the old Base64url-of-JSON design.
        // Latin1 round-trips every byte value 1:1, so this is a deterministic substring check on
        // the actual wire bytes, not a flaky check against random ciphertext.
        var base64 = encoded.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var rawBytesAsText = Encoding.Latin1.GetString(Convert.FromBase64String(base64));

        Assert.DoesNotContain("123456789", rawBytesAsText);
    }

    [Fact]
    public void Encode_IsRandomizedSoTheSameCursorNeverProducesTheSameCiphertextTwice()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(new DateTimeOffset(2026, 9, 4, 10, 0, 0, TimeSpan.Zero), 123);

        var first = codec.Encode(PublicId, cursor);
        var second = codec.Encode(PublicId, cursor);

        // Unlike the old deterministic Base64url-of-JSON design, AES-GCM uses a fresh random nonce
        // per call, so identical inputs never round-trip to identical opaque output - each still
        // decodes back to the same cursor (see the round-trip test above).
        Assert.NotEqual(first, second);
    }

    [Fact]
    public void TryDecode_WithADifferentPublicIdThanItWasEncodedFor_ReturnsFalse()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = codec.Encode(PublicId, cursor);

        var decoded = codec.TryDecode(OtherPublicId, encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    private static string FlipByteAt(string encoded, int byteIndex)
    {
        var base64 = encoded.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var bytes = Convert.FromBase64String(base64);
        bytes[byteIndex] ^= 0xFF;
        return Convert.ToBase64String(bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=');
    }

    [Fact]
    public void TryDecode_WhenEnvelopeVersionByteIsTampered_ReturnsFalse()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = codec.Encode(PublicId, cursor);

        var tampered = FlipByteAt(encoded, byteIndex: 0); // the envelope version byte

        var decoded = codec.TryDecode(PublicId, tampered, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenNonceIsTampered_ReturnsFalse()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = codec.Encode(PublicId, cursor);

        var tampered = FlipByteAt(encoded, byteIndex: 1); // first byte of the 12-byte nonce

        var decoded = codec.TryDecode(PublicId, tampered, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenCiphertextIsTampered_ReturnsFalse()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = codec.Encode(PublicId, cursor);

        var tampered = FlipByteAt(encoded, byteIndex: 13); // first byte after version(1) + nonce(12)

        var decoded = codec.TryDecode(PublicId, tampered, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenAuthTagIsTampered_ReturnsFalse()
    {
        var codec = CreateCodec();
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = codec.Encode(PublicId, cursor);

        var base64 = encoded.Replace('-', '+').Replace('_', '/');
        base64 = base64.PadRight(base64.Length + ((4 - (base64.Length % 4)) % 4), '=');
        var lastByteIndex = Convert.FromBase64String(base64).Length - 1; // last byte of the 16-byte auth tag
        var tampered = FlipByteAt(encoded, lastByteIndex);

        var decoded = codec.TryDecode(PublicId, tampered, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var codec = CreateCodec();

        var decoded = codec.TryDecode(PublicId, "not-valid-base64!!!", out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenTooShortToContainNonceAndTag_ReturnsFalse()
    {
        var codec = CreateCodec();

        var decoded = codec.TryDecode(PublicId, "QQ", out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var codec = CreateCodec();

        var decoded = codec.TryDecode(PublicId, string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WithADifferentEncryptionKeyThanItWasEncodedWith_ReturnsFalse()
    {
        var encodingCodec = CreateCodec(Convert.ToBase64String(Enumerable.Repeat((byte)1, 32).ToArray()));
        var decodingCodec = CreateCodec(Convert.ToBase64String(Enumerable.Repeat((byte)2, 32).ToArray()));
        var cursor = new CollectionItemPageCursor(DateTimeOffset.UtcNow, 123);
        var encoded = encodingCodec.Encode(PublicId, cursor);

        var decoded = decodingCodec.TryDecode(PublicId, encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void Constructor_WhenEncryptionKeyIsMissing_Throws()
    {
        var options = Options.Create(new PublicCollectionCursorOptions { EncryptionKey = string.Empty });

        Assert.Throws<InvalidOperationException>(() => new PublicCollectionItemPageCursorCodec(options));
    }

    [Fact]
    public void Constructor_WhenEncryptionKeyIsNotThirtyTwoBytes_Throws()
    {
        var options = Options.Create(new PublicCollectionCursorOptions
        {
            EncryptionKey = Convert.ToBase64String(new byte[16]),
        });

        Assert.Throws<InvalidOperationException>(() => new PublicCollectionItemPageCursorCodec(options));
    }
}
