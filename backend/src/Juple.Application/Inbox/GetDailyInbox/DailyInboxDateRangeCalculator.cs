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

    /// <summary>
    /// The instant a local calendar day STARTS in this time zone - never "previous day + 24 hours", so a 23 h or 25 h day
    /// (daylight saving) is exactly [start, next start). Two zone quirks are handled instead of throwing or guessing:
    ///  - midnight does not exist (the clocks jump over it, e.g. America/Sao_Paulo before 2019): the day starts at the first
    ///    instant that does exist, i.e. the moment of the jump;
    ///  - midnight happens twice (the clocks fall back over it, e.g. America/Havana): the day starts at the FIRST one.
    /// </summary>
    private static DateTimeOffset ConvertLocalMidnightToUtc(DateOnly date, TimeZoneInfo timeZone)
    {
        var localMidnight = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        if (timeZone.IsInvalidTime(localMidnight))
        {
            var firstValid = localMidnight;
            for (var minute = 0; minute < 24 * 60 && timeZone.IsInvalidTime(firstValid); minute++)
            {
                firstValid = firstValid.AddMinutes(1);
            }

            return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(firstValid, timeZone));
        }

        if (timeZone.IsAmbiguousTime(localMidnight))
        {
            var earliest = timeZone.GetAmbiguousTimeOffsets(localMidnight).Max();
            return new DateTimeOffset(localMidnight, earliest).ToUniversalTime();
        }

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(localMidnight, timeZone));
    }
}