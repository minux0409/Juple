using Juple.Api.RepeatPurchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class RepeatPurchaseVersionCodecTests
{
    [Fact]
    public void EncodeThenTryDecode_RoundTripsExactBytes()
    {
        byte[] rowVersion = [1, 2, 3, 4, 5, 6, 7, 8];

        var encoded = RepeatPurchaseVersionCodec.Encode(rowVersion);
        var decoded = RepeatPurchaseVersionCodec.TryDecode(encoded, out var version);

        Assert.True(decoded);
        Assert.Equal(rowVersion, version);
    }

    [Theory]
    [InlineData("not-valid-base64!!!")]
    [InlineData("")]
    public void TryDecode_WhenNotValidBase64_ReturnsFalse(string value)
    {
        var decoded = RepeatPurchaseVersionCodec.TryDecode(value, out var version);

        Assert.False(decoded);
        Assert.Null(version);
    }

    [Fact]
    public void TryDecode_WhenDecodedLengthIsNotEightBytes_ReturnsFalse()
    {
        // Valid Base64, but not SQL Server's fixed 8-byte rowversion length.
        var wrongLength = Convert.ToBase64String([1, 2, 3]);

        var decoded = RepeatPurchaseVersionCodec.TryDecode(wrongLength, out var version);

        Assert.False(decoded);
        Assert.Null(version);
    }
}
