using Juple.Application.Items.GetItemHistorySections;

namespace Juple.UnitTests.Items;

/// <summary>
/// The History section windows must be exactly the app's groupByLocalDate buckets: 오늘 / 어제 /
/// 이번 주 (Sunday-start, before 어제) / each month before that - in the user's local calendar.
/// </summary>
public sealed class HistorySectionRangesTests
{
    private const string Seoul = "Asia/Seoul";
    private const string NewYork = "America/New_York";

    [Fact]
    public void AWednesday_InSeoul_HasTodayYesterdayAndTheRestOfTheWeek_AsLocalMidnights()
    {
        // 2026-09-30 is a Wednesday; 09:00 there is 00:00 UTC.
        var now = new DateTimeOffset(2026, 9, 30, 0, 0, 0, TimeSpan.Zero);

        var (recent, monthsBefore) = HistorySectionRanges.Recent(now, Seoul);

        Assert.Equal(["2026-09-30", "2026-09-29", "thisWeek"], recent.Select(range => range.Key));
        Assert.Equal([HistorySectionKinds.Today, HistorySectionKinds.Yesterday, HistorySectionKinds.ThisWeek], recent.Select(range => range.Kind));
        // Seoul midnight = 15:00 UTC the day before.
        Assert.Equal(new DateTimeOffset(2026, 9, 29, 15, 0, 0, TimeSpan.Zero), recent[0].FromUtc);
        Assert.Null(recent[0].ToUtc);
        Assert.Equal(new DateTimeOffset(2026, 9, 28, 15, 0, 0, TimeSpan.Zero), recent[1].FromUtc);
        Assert.Equal(recent[0].FromUtc, recent[1].ToUtc);
        // This week: Sunday 2026-09-27 00:00 local up to 어제.
        Assert.Equal(new DateTimeOffset(2026, 9, 26, 15, 0, 0, TimeSpan.Zero), recent[2].FromUtc);
        Assert.Equal(recent[1].FromUtc, recent[2].ToUtc);
        Assert.Equal(recent[2].FromUtc, monthsBefore);
    }

    [Theory]
    [InlineData(27)] // Sunday: yesterday (Saturday) is last week - there is no 이번 주 left
    [InlineData(28)] // Monday: yesterday is Sunday, the week's first day
    public void OnSundayAndMonday_ThereIsNoThisWeekSection_AndMonthsStartBeforeYesterday(int day)
    {
        var now = new DateTimeOffset(2026, 9, day, 3, 0, 0, TimeSpan.Zero);

        var (recent, monthsBefore) = HistorySectionRanges.Recent(now, Seoul);

        Assert.Equal([HistorySectionKinds.Today, HistorySectionKinds.Yesterday], recent.Select(range => range.Kind));
        Assert.Equal(recent[1].FromUtc, monthsBefore);
    }

    [Fact]
    public void Months_RunNewestFirst_ToTheOldestItemsMonth_AndTheNewestEndsWhereThisWeekBegins()
    {
        // Thursday 2026-10-01 in Seoul: the week began on Sunday 09-27 (still September).
        var now = new DateTimeOffset(2026, 10, 1, 3, 0, 0, TimeSpan.Zero);
        var (_, monthsBefore) = HistorySectionRanges.Recent(now, Seoul);
        var oldest = new DateTimeOffset(2026, 7, 10, 0, 0, 0, TimeSpan.Zero);

        var months = HistorySectionRanges.Months(monthsBefore, oldest, Seoul);

        Assert.Equal(["month:2026-09", "month:2026-08", "month:2026-07"], months.Select(month => month.Key));
        Assert.Equal((2026, 9), (months[0].Year, months[0].Month));
        Assert.Equal(monthsBefore, months[0].ToUtc); // September's days in this week belong to 이번 주
        Assert.Equal(new DateTimeOffset(2026, 8, 31, 15, 0, 0, TimeSpan.Zero), months[0].FromUtc);
        Assert.Equal(months[0].FromUtc, months[1].ToUtc);
        Assert.Equal(months[1].FromUtc, months[2].ToUtc);
        Assert.Equal(new DateTimeOffset(2026, 6, 30, 15, 0, 0, TimeSpan.Zero), months[2].FromUtc);
    }

    [Fact]
    public void Months_AreEmpty_WhenNothingIsOlderThanThisWeek()
    {
        var (_, monthsBefore) = HistorySectionRanges.Recent(new DateTimeOffset(2026, 9, 30, 0, 0, 0, TimeSpan.Zero), Seoul);

        Assert.Empty(HistorySectionRanges.Months(monthsBefore, monthsBefore, Seoul));
        Assert.Empty(HistorySectionRanges.Months(monthsBefore, monthsBefore.AddDays(1), Seoul));
    }

    [Fact]
    public void AcrossDaylightSavingTime_EachMonthStartsAtThatDatesOwnLocalMidnight()
    {
        // New York: EDT (UTC-4) until 2026-11-01, EST (UTC-5) after. Now: Friday 2026-12-11.
        var now = new DateTimeOffset(2026, 12, 11, 17, 0, 0, TimeSpan.Zero);
        var (recent, monthsBefore) = HistorySectionRanges.Recent(now, NewYork);
        var months = HistorySectionRanges.Months(monthsBefore, new DateTimeOffset(2026, 10, 15, 0, 0, 0, TimeSpan.Zero), NewYork);

        Assert.Equal(new DateTimeOffset(2026, 12, 11, 5, 0, 0, TimeSpan.Zero), recent[0].FromUtc); // EST midnight
        Assert.Equal(["month:2026-12", "month:2026-11", "month:2026-10"], months.Select(month => month.Key));
        Assert.Equal(new DateTimeOffset(2026, 12, 1, 5, 0, 0, TimeSpan.Zero), months[0].FromUtc); // EST
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 4, 0, 0, TimeSpan.Zero), months[1].FromUtc); // still EDT at 00:00 on 11-01
        Assert.Equal(new DateTimeOffset(2026, 10, 1, 4, 0, 0, TimeSpan.Zero), months[2].FromUtc); // EDT
    }

    [Fact]
    public void TheLocalDayDecides_NotTheUtcDay()
    {
        // 23:30 UTC on 09-29 is already 08:30 on 09-30 in Seoul.
        var (recent, _) = HistorySectionRanges.Recent(new DateTimeOffset(2026, 9, 29, 23, 30, 0, TimeSpan.Zero), Seoul);

        Assert.Equal("2026-09-30", recent[0].Key);
    }
}
