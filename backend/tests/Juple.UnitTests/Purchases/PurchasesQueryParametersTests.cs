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
}
