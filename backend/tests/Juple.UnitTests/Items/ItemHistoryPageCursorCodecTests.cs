using Juple.Api.Items;
using Juple.Application.Items;

namespace Juple.UnitTests.Items;

public sealed class ItemHistoryPageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new ItemHistoryPageCursor(new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero), 123);

        var encoded = ItemHistoryPageCursorCodec.Encode(cursor);
        var decoded = ItemHistoryPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = ItemHistoryPageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

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

        var decoded = ItemHistoryPageCursorCodec.TryDecode(notJson, out var result);

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

        var decoded = ItemHistoryPageCursorCodec.TryDecode(encoded, out var result);

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

        var decoded = ItemHistoryPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = ItemHistoryPageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void ANameCursor_RoundTripsWithItsBucketAndKey_IncludingNonLatinText()
    {
        var cursor = new ItemHistoryPageCursor(new DateTimeOffset(2026, 8, 29, 10, 0, 0, TimeSpan.Zero), 7, ItemNameOrder.Titled, "가나다 \"quoted\" / slash");

        Assert.True(ItemHistoryPageCursorCodec.TryDecode(ItemHistoryPageCursorCodec.Encode(cursor), out var result));
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void ATimeCursorCarriesNoNameFields_AndANameCursorIsNotATimeCursor()
    {
        Assert.True(ItemHistoryPageCursorCodec.TryDecode(ItemHistoryPageCursorCodec.Encode(new ItemHistoryPageCursor(DateTimeOffset.UnixEpoch, 5)), out var time));
        Assert.Null(time!.NameBucket);
        Assert.Null(time.NameKey);
    }

    [Theory]
    [InlineData("{\"V\":1,\"T\":\"2026-08-29T10:00:00+00:00\",\"Id\":5,\"B\":1}")]
    [InlineData("{\"V\":1,\"T\":\"2026-08-29T10:00:00+00:00\",\"Id\":5,\"K\":\"x\"}")]
    [InlineData("{\"V\":1,\"T\":\"2026-08-29T10:00:00+00:00\",\"Id\":5,\"B\":9,\"K\":\"x\"}")]
    [InlineData("{\"V\":1,\"T\":\"2026-08-29T10:00:00+00:00\",\"Id\":5,\"B\":-1,\"K\":\"x\"}")]
    public void AHalfFormedOrOutOfRangeNameCursor_IsRejected(string json)
    {
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(json)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

        Assert.False(ItemHistoryPageCursorCodec.TryDecode(encoded, out var result));
        Assert.Null(result);
    }
}
