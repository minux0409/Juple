using Juple.Api.RepeatPurchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class RepeatPurchasesQueryParametersTests
{
    [Fact]
    public void TryParseLimit_WhenAbsent_ReturnsDefaultLimit()
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseLimit(null, out var limit);

        Assert.True(parsed);
        Assert.Equal(RepeatPurchasesQueryParameters.DefaultLimit, limit);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    [InlineData(50)]
    public void TryParseLimit_WhenWithinRange_ReturnsThatLimit(int value)
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseLimit(value, out var limit);

        Assert.True(parsed);
        Assert.Equal(value, limit);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void TryParseLimit_WhenOutOfRange_ReturnsFalse(int value)
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseLimit(value, out _);

        Assert.False(parsed);
    }

    [Fact]
    public void TryParseItemId_WhenAbsent_ReturnsNull()
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseItemId(null, out var itemId);

        Assert.True(parsed);
        Assert.Null(itemId);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(42)]
    public void TryParseItemId_WhenPositive_ReturnsThatItemId(long value)
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseItemId(value, out var itemId);

        Assert.True(parsed);
        Assert.Equal(value, itemId);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void TryParseItemId_WhenNotPositive_ReturnsFalse(long value)
    {
        var parsed = RepeatPurchasesQueryParameters.TryParseItemId(value, out _);

        Assert.False(parsed);
    }

    [Theory]
    [InlineData("true")]
    [InlineData("TRUE")]
    [InlineData("True")]
    public void ParseIncludeDisabled_WhenTrue_ReturnsTrue(string value)
    {
        Assert.True(RepeatPurchasesQueryParameters.ParseIncludeDisabled(value));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("false")]
    [InlineData("1")]
    [InlineData("yes")]
    public void ParseIncludeDisabled_WhenAbsentOrAnythingElse_ReturnsFalse(string? value)
    {
        Assert.False(RepeatPurchasesQueryParameters.ParseIncludeDisabled(value));
    }
}
