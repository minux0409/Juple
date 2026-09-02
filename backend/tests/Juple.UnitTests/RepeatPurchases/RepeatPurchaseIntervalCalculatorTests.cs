using Juple.Domain.Purchases;

namespace Juple.UnitTests.RepeatPurchases;

public sealed class RepeatPurchaseIntervalCalculatorTests
{
    [Fact]
    public void TryCalculateNextPurchaseDate_Day_AddsIntervalValueAsDays()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), 30, IntervalUnit.Day, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2026, 10, 2), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Week_AddsIntervalValueTimesSevenDays()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), 2, IntervalUnit.Week, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2026, 9, 16), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_AddsIntervalValueAsCalendarMonths()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), 3, IntervalUnit.Month, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2026, 12, 2), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_JanuaryThirtyFirstPlusOneMonth_ClampsToFebruaryTwentyEighth()
    {
        // 2026 is not a leap year - February has 28 days, so Jan 31 has no matching day in
        // February and DateOnly.AddMonths clamps to the last valid day of the target month.
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 1, 31), 1, IntervalUnit.Month, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2026, 2, 28), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_JanuaryThirtyFirstPlusOneMonthInLeapYear_ClampsToFebruaryTwentyNinth()
    {
        // 2028 is a leap year - the clamp target is Feb 29, not Feb 28.
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2028, 1, 31), 1, IntervalUnit.Month, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2028, 2, 29), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_FromFebruaryTwentyNinthInLeapYearPlusOneYear_ClampsToFebruaryTwentyEighth()
    {
        // Crossing back out of a leap year via 12 months also clamps correctly.
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2028, 2, 29), 12, IntervalUnit.Month, out var result);

        Assert.True(succeeded);
        Assert.Equal(new DateOnly(2029, 2, 28), result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Week_HugeIntervalValue_FailsWithoutWrapping()
    {
        // IntervalValue * 7 overflows a 32-bit int for any IntervalValue beyond ~306.8 million.
        // int.MaxValue * 7 wraps (unchecked) to a small/negative number that would otherwise
        // silently succeed with a nonsense date - this must instead fail cleanly.
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), int.MaxValue, IntervalUnit.Week, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Day_HugeIntervalValue_Fails()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), int.MaxValue, IntervalUnit.Day, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_HugeIntervalValue_Fails()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            new DateOnly(2026, 9, 2), int.MaxValue, IntervalUnit.Month, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Day_OneDayPastDateOnlyMaxValue_Fails()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            DateOnly.MaxValue, 1, IntervalUnit.Day, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Week_OneWeekPastDateOnlyMaxValue_Fails()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            DateOnly.MaxValue, 1, IntervalUnit.Week, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Month_OneMonthPastDateOnlyMaxValue_Fails()
    {
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            DateOnly.MaxValue, 1, IntervalUnit.Month, out var result);

        Assert.False(succeeded);
        Assert.Equal(default, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_Day_ExactlyDateOnlyMaxValue_Succeeds()
    {
        // The last day still inside DateOnly's range must not be rejected by an off-by-one.
        var succeeded = RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
            DateOnly.MaxValue.AddDays(-1), 1, IntervalUnit.Day, out var result);

        Assert.True(succeeded);
        Assert.Equal(DateOnly.MaxValue, result);
    }

    [Fact]
    public void TryCalculateNextPurchaseDate_UnknownIntervalUnit_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            RepeatPurchaseIntervalCalculator.TryCalculateNextPurchaseDate(
                new DateOnly(2026, 9, 2), 1, (IntervalUnit)99, out _));
    }
}
