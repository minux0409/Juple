using Juple.Api.Purchases;

namespace Juple.UnitTests.Purchases;

public sealed class PurchasesQueryParametersTests
{
    [Fact]
    public void TryParseLimit_WhenAbsent_ReturnsDefaultLimit()
    {
        var parsed = PurchasesQueryParameters.TryParseLimit(null, out var limit);

        Assert.True(parsed);
        Assert.Equal(PurchasesQueryParameters.DefaultLimit, limit);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(100)]
    [InlineData(50)]
    public void TryParseLimit_WhenWithinRange_ReturnsThatLimit(int value)
    {
        var parsed = PurchasesQueryParameters.TryParseLimit(value, out var limit);

        Assert.True(parsed);
        Assert.Equal(value, limit);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(101)]
    public void TryParseLimit_WhenOutOfRange_ReturnsFalse(int value)
    {
        var parsed = PurchasesQueryParameters.TryParseLimit(value, out _);

        Assert.False(parsed);
    }

    [Fact]
    public void TryParseItemId_WhenAbsent_ReturnsNull()
    {
        var parsed = PurchasesQueryParameters.TryParseItemId(null, out var itemId);

        Assert.True(parsed);
        Assert.Null(itemId);
    }

    [Theory]
    [InlineData(1)]
    [InlineData(42)]
    [InlineData(long.MaxValue)]
    public void TryParseItemId_WhenPositive_ReturnsThatItemId(long value)
    {
        var parsed = PurchasesQueryParameters.TryParseItemId(value, out var itemId);

        Assert.True(parsed);
        Assert.Equal(value, itemId);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(long.MinValue)]
    public void TryParseItemId_WhenNotPositive_ReturnsFalse(long value)
    {
        var parsed = PurchasesQueryParameters.TryParseItemId(value, out _);

        Assert.False(parsed);
    }
}
