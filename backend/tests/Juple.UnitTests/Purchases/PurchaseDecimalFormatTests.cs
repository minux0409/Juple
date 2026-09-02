using Juple.Api.Purchases;

namespace Juple.UnitTests.Purchases;

public sealed class PurchaseDecimalFormatTests
{
    [Fact]
    public void Format_WhenNull_ReturnsNull()
    {
        Assert.Null(PurchaseDecimalFormat.Format(null));
    }

    [Theory]
    [InlineData("19900.0000", "19900")]
    [InlineData("19.9000", "19.9")]
    [InlineData("0.0000", "0")]
    [InlineData("2.500", "2.5")]
    [InlineData("100.0000", "100")]
    public void Format_TrimsInsignificantTrailingZerosFromTheDbColumnScale(string rawText, string expected)
    {
        var value = decimal.Parse(rawText, System.Globalization.CultureInfo.InvariantCulture);

        Assert.Equal(expected, PurchaseDecimalFormat.Format(value));
    }

    [Fact]
    public void Format_AtTheDecimal19_4Maximum_PreservesEveryDigitExactly()
    {
        var max = 999_999_999_999_999.9999m;

        Assert.Equal("999999999999999.9999", PurchaseDecimalFormat.Format(max));
    }

    [Fact]
    public void Format_AtTheDecimal18_3Maximum_PreservesEveryDigitExactly()
    {
        var max = 999_999_999_999_999.999m;

        Assert.Equal("999999999999999.999", PurchaseDecimalFormat.Format(max));
    }

    [Fact]
    public void Format_NeverEmitsScientificNotation()
    {
        var verySmall = 0.0001m;

        Assert.Equal("0.0001", PurchaseDecimalFormat.Format(verySmall));
    }

    [Fact]
    public void Format_WithNoFractionalPart_ReturnsIntegerTextUnchanged()
    {
        Assert.Equal("42", PurchaseDecimalFormat.Format(42m));
    }
}
