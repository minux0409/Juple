namespace Juple.Application.Inbox.GetDailyInbox;

public static class DailyInboxDateRangeCalculator
{
    public static DailyInboxDateRange Calculate(DateOnly date, string timeZoneId)
    {
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var fromUtc = ConvertLocalMidnightToUtc(date, timeZone);
        var toUtc = ConvertLocalMidnightToUtc(date.AddDays(1), timeZone);
        return new DailyInboxDateRange(fromUtc, toUtc);
    }

    public static DateOnly GetLocalDate(DateTimeOffset utcNow, string timeZoneId)
    {
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        return DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(utcNow, timeZone).DateTime);
    }

    private static DateTimeOffset ConvertLocalMidnightToUtc(DateOnly date, TimeZoneInfo timeZone)
    {
        var localMidnight = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(localMidnight, timeZone));
    }
}