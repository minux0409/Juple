using Juple.Application.Inbox.GetDailyInbox;

namespace Juple.Application.Items.GetItemHistoryCalendar;

/// <summary>One local calendar day that has links - Date is "YYYY-MM-DD" in the caller's stored time zone, exactly what GET history/date takes.</summary>
public sealed record CalendarDayCountDto(string Date, int Count);

/// <summary>
/// A month of the calendar view (Archive or a Collection): ONLY the days that have links, with their
/// exact counts - never link data. The days' links come from the existing paged endpoints
/// (GET items/history/date, GET collections/{id}/items?fromUtc&amp;toUtc).
/// </summary>
public sealed record CalendarMonthDto(int Year, int Month, IReadOnlyList<CalendarDayCountDto> Days);

public sealed class InvalidCalendarMonthException(string field) : Exception($"{field} is not a valid calendar month.")
{
    public string Field { get; } = field;
}

/// <summary>The UTC window of every local day of a month, in the caller's time zone (DST-correct: a day is local midnight to the next local midnight).</summary>
public static class CalendarMonthRanges
{
    public const int MinYear = 2000;
    public const int MaxYear = 2100;

    public static IReadOnlyList<(DateOnly Date, DateTimeOffset FromUtc, DateTimeOffset ToUtc)> Days(int year, int month, string timeZoneId)
    {
        if (year is < MinYear or > MaxYear)
        {
            throw new InvalidCalendarMonthException("year");
        }

        if (month is < 1 or > 12)
        {
            throw new InvalidCalendarMonthException("month");
        }

        var days = new List<(DateOnly, DateTimeOffset, DateTimeOffset)>(DateTime.DaysInMonth(year, month));
        for (var day = 1; day <= DateTime.DaysInMonth(year, month); day++)
        {
            var date = new DateOnly(year, month, day);
            var range = DailyInboxDateRangeCalculator.Calculate(date, timeZoneId);
            days.Add((date, range.FromUtc, range.ToUtc));
        }

        return days;
    }

    public static CalendarMonthDto ToMonth(int year, int month, IReadOnlyList<(DateOnly Date, DateTimeOffset FromUtc, DateTimeOffset ToUtc)> days, IReadOnlyList<int> counts) =>
        new(
            year,
            month,
            days.Select((day, index) => new CalendarDayCountDto(day.Date.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture), counts[index]))
                .Where(day => day.Count > 0)
                .ToList());
}

public interface IGetItemHistoryCalendarService
{
    /// <summary>The caller's own History (Trash excluded) per local day of that month - one statement for the whole month.</summary>
    Task<CalendarMonthDto> GetAsync(long userId, string timeZoneId, int year, int month, CancellationToken cancellationToken = default);
}

public sealed class GetItemHistoryCalendarService(IItemHistoryQueryStore itemHistoryQueryStore) : IGetItemHistoryCalendarService
{
    public async Task<CalendarMonthDto> GetAsync(long userId, string timeZoneId, int year, int month, CancellationToken cancellationToken = default)
    {
        var days = CalendarMonthRanges.Days(year, month, timeZoneId);
        var counts = await itemHistoryQueryStore.CountByRangesAsync(userId, days.Select(day => (day.FromUtc, day.ToUtc)).ToList(), cancellationToken);
        return CalendarMonthRanges.ToMonth(year, month, days, counts);
    }
}
