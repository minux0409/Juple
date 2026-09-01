using Juple.Api.Items;
using Juple.Application.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemPageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new ItemPageCursor(new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero), 123);

        var encoded = ItemPageCursorCodec.Encode(cursor);
        var decoded = ItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = ItemPageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

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

        var decoded = ItemPageCursorCodec.TryDecode(notJson, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenVersionIsUnsupported_ReturnsFalse()
    {
        var payloadJson = """{"V":2,"T":"2026-08-29T10:00:00+00:00","Id":123}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = ItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenIdIsNotPositive_ReturnsFalse()
    {
        var payloadJson = """{"V":1,"T":"2026-08-29T10:00:00+00:00","Id":0}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = ItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = ItemPageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }
}
