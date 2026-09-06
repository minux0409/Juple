using Juple.Api.Items;
using Juple.Application.Items;

namespace Juple.UnitTests.Items;

public sealed class RecentlyOpenedItemPageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new RecentlyOpenedItemPageCursor(new DateTimeOffset(2026, 9, 6, 10, 0, 0, TimeSpan.Zero), 123);

        var encoded = RecentlyOpenedItemPageCursorCodec.Encode(cursor);
        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

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

        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode(notJson, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenVersionIsUnsupported_ReturnsFalse()
    {
        var payloadJson = """{"V":2,"T":"2026-09-06T10:00:00+00:00","ItemId":123}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenItemIdIsNotPositive_ReturnsFalse()
    {
        var payloadJson = """{"V":1,"T":"2026-09-06T10:00:00+00:00","ItemId":0}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = RecentlyOpenedItemPageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }
}
