using Juple.Application.Inbox.GetDailyInbox;
using Juple.Application.Items.GetItemHistoryCalendar;

namespace Juple.UnitTests.Inbox;

/// <summary>
/// One canonical rule for "a calendar day": the month counts, Archive's by-date list and a Collection's by-date list
/// all use DailyInboxDateRangeCalculator on the user's stored time zone, as [start of the day, start of the next day).
/// </summary>
public sealed class CalendarDayRangeTests
{
    private static readonly TimeSpan SeoulOffset = TimeSpan.FromHours(9);

    [Fact]
    public void ANormalDay_IsLocalMidnightToLocalMidnight_NotUtcMidnight()
    {
        var range = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 10, 5), "Asia/Seoul");

        Assert.Equal(new DateTimeOffset(2026, 10, 5, 0, 0, 0, SeoulOffset).ToUniversalTime(), range.FromUtc);
        Assert.Equal(new DateTimeOffset(2026, 10, 6, 0, 0, 0, SeoulOffset).ToUniversalTime(), range.ToUtc);
        Assert.Equal(TimeSpan.FromHours(24), range.ToUtc - range.FromUtc);
    }

    [Fact]
    public void TheSameCalendarDay_IsADifferentInterval_InADifferentTimeZone()
    {
        var seoul = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 10, 5), "Asia/Seoul");
        var losAngeles = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 10, 5), "America/Los_Angeles");

        Assert.NotEqual(seoul.FromUtc, losAngeles.FromUtc);
        Assert.Equal(new DateTimeOffset(2026, 10, 5, 0, 0, 0, TimeSpan.FromHours(-7)).ToUniversalTime(), losAngeles.FromUtc); // PDT
    }

    [Fact]
    public void AnInstantOneTickEitherSideOfLocalMidnight_BelongsToExactlyOneDay()
    {
        var day = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 10, 5), "Asia/Seoul");
        var previous = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 10, 4), "Asia/Seoul");

        Assert.Equal(day.FromUtc, previous.ToUtc); // adjacent days share the boundary - no gap, no overlap
        var justBefore = day.FromUtc.AddTicks(-1);
        Assert.True(justBefore >= previous.FromUtc && justBefore < previous.ToUtc);
        Assert.False(justBefore >= day.FromUtc && justBefore < day.ToUtc);
        Assert.True(day.FromUtc >= day.FromUtc && day.FromUtc < day.ToUtc); // exactly midnight is the new day
    }

    [Fact]
    public void ADaylightSavingDay_IsNotTwentyFourHours()
    {
        // America/New_York: spring forward 2026-03-08 (23 h), fall back 2026-11-01 (25 h).
        var spring = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 3, 8), "America/New_York");
        var fall = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 11, 1), "America/New_York");
        var normal = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2026, 6, 10), "America/New_York");

        Assert.Equal(TimeSpan.FromHours(23), spring.ToUtc - spring.FromUtc);
        Assert.Equal(TimeSpan.FromHours(25), fall.ToUtc - fall.FromUtc);
        Assert.Equal(TimeSpan.FromHours(24), normal.ToUtc - normal.FromUtc);
        // Each day starts at local midnight (EST before the spring jump, EDT before the fall-back).
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 0, 0, 0, TimeSpan.FromHours(-5)).ToUniversalTime(), spring.FromUtc);
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.FromHours(-4)).ToUniversalTime(), fall.FromUtc);
    }

    [Fact]
    public void AMonthOfDays_TilesTheTimeline_WithNoGapAndNoOverlap_AcrossDaylightSaving()
    {
        foreach (var (zone, year, month) in new[] { ("America/New_York", 2026, 3), ("America/New_York", 2026, 11), ("Europe/Berlin", 2026, 10), ("Australia/Sydney", 2026, 10), ("Asia/Seoul", 2026, 10) })
        {
            var days = CalendarMonthRanges.Days(year, month, zone);
            Assert.Equal(DateTime.DaysInMonth(year, month), days.Count);
            for (var index = 1; index < days.Count; index++)
            {
                Assert.Equal(days[index - 1].ToUtc, days[index].FromUtc);
            }

            Assert.All(days, day => Assert.True(day.ToUtc > day.FromUtc));
        }
    }

    [Fact]
    public void WhenMidnightDoesNotExist_TheDayStartsAtTheMomentOfTheJump_NotAnException()
    {
        // America/Sao_Paulo 2018-11-04: the clocks jumped from 00:00 to 01:00 (DST began at midnight).
        var day = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2018, 11, 4), "America/Sao_Paulo");
        var previous = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2018, 11, 3), "America/Sao_Paulo");

        Assert.Equal(new DateTimeOffset(2018, 11, 4, 1, 0, 0, TimeSpan.FromHours(-2)).ToUniversalTime(), day.FromUtc);
        Assert.Equal(previous.ToUtc, day.FromUtc);
        Assert.Equal(TimeSpan.FromHours(23), day.ToUtc - day.FromUtc);
    }

    [Fact]
    public void WhenMidnightHappensTwice_TheDayStartsAtTheFirstOne()
    {
        // America/Havana 2020-11-01: at 01:00 DST the clocks went back to 00:00 - so local midnight happened twice.
        var day = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2020, 11, 1), "America/Havana");
        var next = DailyInboxDateRangeCalculator.Calculate(new DateOnly(2020, 11, 2), "America/Havana");

        Assert.Equal(new DateTimeOffset(2020, 11, 1, 0, 0, 0, TimeSpan.FromHours(-4)).ToUniversalTime(), day.FromUtc); // the CDT midnight, the earlier instant
        Assert.Equal(TimeSpan.FromHours(25), next.FromUtc - day.FromUtc);
    }

    [Theory]
    [InlineData(1999, 12)]
    [InlineData(2101, 1)]
    [InlineData(2026, 0)]
    [InlineData(2026, 13)]
    public void AnInvalidMonth_IsRejected(int year, int month)
    {
        Assert.Throws<InvalidCalendarMonthException>(() => CalendarMonthRanges.Days(year, month, "Asia/Seoul"));
    }
}
