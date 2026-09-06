using Juple.Api.Push;
using Juple.Domain.Push;

namespace Juple.UnitTests.Push;

public sealed class PushPlatformWireFormatTests
{
    [Theory]
    [InlineData(PushPlatform.Android, "android")]
    [InlineData(PushPlatform.Ios, "ios")]
    public void ToWireValue_ReturnsLowercaseWireString(PushPlatform platform, string expected)
    {
        Assert.Equal(expected, PushPlatformWireFormat.ToWireValue(platform));
    }

    [Theory]
    [InlineData("android", PushPlatform.Android)]
    [InlineData("ios", PushPlatform.Ios)]
    [InlineData("ANDROID", PushPlatform.Android)]
    [InlineData("IOS", PushPlatform.Ios)]
    public void TryParse_WhenValidWireValue_ReturnsMatchingPlatform(string value, PushPlatform expected)
    {
        var parsed = PushPlatformWireFormat.TryParse(value, out var platform);

        Assert.True(parsed);
        Assert.Equal(expected, platform);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("windows")]
    [InlineData("0")]
    public void TryParse_WhenInvalidOrMissing_ReturnsFalse(string? value)
    {
        var parsed = PushPlatformWireFormat.TryParse(value, out _);

        Assert.False(parsed);
    }
}
