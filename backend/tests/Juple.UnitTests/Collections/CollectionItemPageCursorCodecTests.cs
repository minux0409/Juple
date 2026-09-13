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
}
