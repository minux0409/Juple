using Juple.Api.RepeatPurchases;
using Juple.Domain.Purchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class IntervalUnitWireFormatTests
{
    [Theory]
    [InlineData(IntervalUnit.Day, "day")]
    [InlineData(IntervalUnit.Week, "week")]
    [InlineData(IntervalUnit.Month, "month")]
    public void ToWireValue_ReturnsLowercaseWireString(IntervalUnit intervalUnit, string expected)
    {
        Assert.Equal(expected, IntervalUnitWireFormat.ToWireValue(intervalUnit));
    }

    [Theory]
    [InlineData("day", IntervalUnit.Day)]
    [InlineData("week", IntervalUnit.Week)]
    [InlineData("month", IntervalUnit.Month)]
    [InlineData("DAY", IntervalUnit.Day)]
    [InlineData("Week", IntervalUnit.Week)]
    public void TryParse_WhenValidWireValue_ReturnsMatchingIntervalUnit(string value, IntervalUnit expected)
    {
        var parsed = IntervalUnitWireFormat.TryParse(value, out var intervalUnit);

        Assert.True(parsed);
        Assert.Equal(expected, intervalUnit);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("days")]
    [InlineData("yearly")]
    [InlineData("0")]
    public void TryParse_WhenInvalidOrMissing_ReturnsFalse(string? value)
    {
        var parsed = IntervalUnitWireFormat.TryParse(value, out _);

        Assert.False(parsed);
    }
}
