using Juple.Api.Notifications;
using Juple.Application.Notifications;

namespace Juple.UnitTests.Notifications;

public sealed class NotificationPageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new NotificationPageCursor(new DateTimeOffset(2026, 9, 30, 12, 0, 0, TimeSpan.Zero), 123);

        var encoded = NotificationPageCursorCodec.Encode(cursor);
        var decoded = NotificationPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = NotificationPageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenVersionIsUnsupported_ReturnsFalse()
    {
        var payloadJson = """{"V":2,"T":"2026-09-30T12:00:00+00:00","Id":123}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = NotificationPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenIdIsNotPositive_ReturnsFalse()
    {
        var payloadJson = """{"V":1,"T":"2026-09-30T12:00:00+00:00","Id":0}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = NotificationPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = NotificationPageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }
}
