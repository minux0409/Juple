using Juple.Api.Purchases;
using Juple.Application.Purchases;

namespace Juple.UnitTests.Purchases;

public sealed class PurchasePageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new PurchasePageCursor(new DateOnly(2026, 8, 29), 123);

        var encoded = PurchasePageCursorCodec.Encode(cursor);
        var decoded = PurchasePageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = PurchasePageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenBase64ButNotJson_ReturnsFalse()
    {
        var notJson = Convert.ToBase64String("this is not json"u8.ToArray())
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = PurchasePageCursorCodec.TryDecode(notJson, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenVersionIsUnsupported_ReturnsFalse()
    {
        var payloadJson = """{"V":2,"Date":"2026-08-29","Id":123}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = PurchasePageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenIdIsNotPositive_ReturnsFalse()
    {
        var payloadJson = """{"V":1,"Date":"2026-08-29","Id":0}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = PurchasePageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = PurchasePageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }
}
