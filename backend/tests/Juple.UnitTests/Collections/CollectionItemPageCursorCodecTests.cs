using Juple.Api.Collections;
using Juple.Application.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CollectionItemPageCursorCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsToTheSameCursor()
    {
        var cursor = new CollectionItemPageCursor(4096, 123);

        var encoded = CollectionItemPageCursorCodec.Encode(cursor);
        var decoded = CollectionItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void EncodeThenTryDecode_RoundTripsANegativeSortOrder()
    {
        // A prepended Item's SortOrder can go negative (see CollectionStore.AddAsync) - the cursor
        // must round-trip that too, not just positive/zero values.
        var cursor = new CollectionItemPageCursor(-4096, 123);

        var encoded = CollectionItemPageCursorCodec.Encode(cursor);
        var decoded = CollectionItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.True(decoded);
        Assert.Equal(cursor, result);
    }

    [Fact]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse()
    {
        var decoded = CollectionItemPageCursorCodec.TryDecode("not-valid-base64!!!", out var result);

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

        var decoded = CollectionItemPageCursorCodec.TryDecode(notJson, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenVersionIsUnsupported_ReturnsFalse()
    {
        // V:1 is the old (pre-reorder) AddedAtUtc-based payload shape - must fail closed, not be
        // misread as a SortOrder-based cursor.
        var payloadJson = """{"V":1,"S":123,"ItemId":123}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = CollectionItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenItemIdIsNotPositive_ReturnsFalse()
    {
        var payloadJson = """{"V":2,"S":123,"ItemId":0}""";
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(payloadJson))
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');

        var decoded = CollectionItemPageCursorCodec.TryDecode(encoded, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Fact]
    public void TryDecode_WhenEmpty_ReturnsFalse()
    {
        var decoded = CollectionItemPageCursorCodec.TryDecode(string.Empty, out var result);

        Assert.False(decoded);
        Assert.Null(result);
    }

    [Theory]
    [InlineData(CollectionItemSort.DateDesc)]
    [InlineData(CollectionItemSort.DateAsc)]
    public void ADateCursor_RoundTripsWithItsOrderAndExactTimestamp(CollectionItemSort sort)
    {
        var cursor = CollectionItemPageCursor.ForDate(sort, new DateTimeOffset(2026, 9, 28, 7, 5, 59, 123, TimeSpan.Zero).AddTicks(4567), 321);

        Assert.True(CollectionItemPageCursorCodec.TryDecode(CollectionItemPageCursorCodec.Encode(cursor), out var result));
        Assert.Equal(cursor, result);
        Assert.Equal(sort, result!.Sort);
        Assert.Equal(cursor.AddedAtUtc.UtcTicks, result.AddedAtUtc.UtcTicks);
    }

    [Fact]
    public void AManualCursor_KeepsTheExactVersion2WireShapeOlderClientsHold()
    {
        var encoded = CollectionItemPageCursorCodec.Encode(new CollectionItemPageCursor(-40, 7));
        var json = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(
            encoded.Replace('-', '+').Replace('_', '/').PadRight(encoded.Length + (4 - encoded.Length % 4) % 4, '=')));

        Assert.Equal("{\"V\":2,\"S\":-40,\"ItemId\":7}", json);
        Assert.True(CollectionItemPageCursorCodec.TryDecode(encoded, out var result));
        Assert.Equal(CollectionItemSort.Manual, result!.Sort);
    }

    [Theory]
    [InlineData("{\"V\":3,\"S\":0,\"ItemId\":7,\"O\":\"title\",\"T\":\"2026-01-01T00:00:00+00:00\"}")]
    [InlineData("{\"V\":3,\"S\":0,\"ItemId\":7,\"O\":\"dateDesc\"}")]
    [InlineData("{\"V\":2,\"S\":0,\"ItemId\":7,\"O\":\"dateDesc\",\"T\":\"2026-01-01T00:00:00+00:00\"}")]
    public void AMalformedDateCursor_FailsClosed(string json)
    {
        var encoded = Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(json)).Replace('+', '-').Replace('/', '_').TrimEnd('=');

        Assert.False(CollectionItemPageCursorCodec.TryDecode(encoded, out var result));
        Assert.Null(result);
    }
}
