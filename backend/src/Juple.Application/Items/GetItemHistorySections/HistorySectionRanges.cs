using System.Globalization;
using Juple.Application.Inbox.GetDailyInbox;

namespace Juple.Application.Items.GetItemHistorySections;

/// <summary>Stable wire values of a History section's kind - the client words them (i18n), the server never does.</summary>
public static class HistorySectionKinds
{
    public const string Today = "today";
    public const string Yesterday = "yesterday";
    public const string ThisWeek = "thisWeek";
    public const string Month = "month";
}

/// <summary>
/// One History section's identity and its UTC window [FromUtc, ToUtc) - ToUtc null means open-ended
/// (오늘 also takes anything saved "after now", e.g. from a device clock ahead of the server's).
/// Key matches the app's own section keys: "YYYY-MM-DD" for 오늘/어제, "thisWeek", "month:YYYY-MM".
/// </summary>
public sealed record HistorySectionRange(
    string Key,
    string Kind,
    int? Year,
    int? Month,
    DateTimeOffset FromUtc,
    DateTimeOffset? ToUtc);

/// <summary>
/// The History sections - 오늘, 어제, 이번 주 (Sunday-start week, excluding 오늘/어제), then one per
/// calendar month - as UTC windows of the user's local calendar. Local midnights are converted per
/// date with TimeZoneInfo (so DST and historical offsets are exact for each date), the same way
/// Home's DailyInboxDateRangeCalculator does - never one fixed offset applied to every past date.
/// Mirrors the app's groupByLocalDate rules, so its section keys and these always agree.
/// </summary>
public static class HistorySectionRanges
{
    /// <summary>
    /// 오늘/어제/이번 주 (이번 주 only when the week has days before 어제) and the instant before which
    /// every older Item belongs to a month section.
    /// </summary>
    public static (IReadOnlyList<HistorySectionRange> Recent, DateTimeOffset MonthsBeforeUtc) Recent(DateTimeOffset nowUtc, string timeZoneId)
    {
        var today = DailyInboxDateRangeCalculator.GetLocalDate(nowUtc, timeZoneId);
        var yesterday = today.AddDays(-1);
        var weekStart = today.AddDays(-(int)today.DayOfWeek);
        var todayStartUtc = Midnight(today, timeZoneId);
        var yesterdayStartUtc = Midnight(yesterday, timeZoneId);

        var recent = new List<HistorySectionRange>
        {
            new(DateKey(today), HistorySectionKinds.Today, null, null, todayStartUtc, null),
            new(DateKey(yesterday), HistorySectionKinds.Yesterday, null, null, yesterdayStartUtc, todayStartUtc),
        };

        // 이번 주 is what is left of the current week before 어제 - nothing on Sunday or Monday.
        var monthsBefore = yesterday;
        if (weekStart < yesterday)
        {
            recent.Add(new("thisWeek", HistorySectionKinds.ThisWeek, null, null, Midnight(weekStart, timeZoneId), yesterdayStartUtc));
            monthsBefore = weekStart;
        }

        return (recent, Midnight(monthsBefore, timeZoneId));
    }

    /// <summary>
    /// Every calendar month from the one just before MonthsBeforeUtc back to the one holding the
    /// oldest Item, newest first. The newest one ends at MonthsBeforeUtc (the rest of that month
    /// belongs to 이번 주/어제).
    /// </summary>
    public static IReadOnlyList<HistorySectionRange> Months(DateTimeOffset monthsBeforeUtc, DateTimeOffset oldestSavedAtUtc, string timeZoneId)
    {
        var months = new List<HistorySectionRange>();
        if (oldestSavedAtUtc >= monthsBeforeUtc)
        {
            return months;
        }

        var newestDay = DailyInboxDateRangeCalculator.GetLocalDate(monthsBeforeUtc.AddTicks(-1), timeZoneId);
        var oldestDay = DailyInboxDateRangeCalculator.GetLocalDate(oldestSavedAtUtc, timeZoneId);
        var month = new DateOnly(newestDay.Year, newestDay.Month, 1);
        var oldestMonth = new DateOnly(oldestDay.Year, oldestDay.Month, 1);
        var toUtc = monthsBeforeUtc;
        while (month >= oldestMonth)
        {
            var fromUtc = Midnight(month, timeZoneId);
            months.Add(new(
                string.Create(CultureInfo.InvariantCulture, $"month:{month.Year:D4}-{month.Month:D2}"),
                HistorySectionKinds.Month, month.Year, month.Month, fromUtc, toUtc));
            toUtc = fromUtc;
            month = month.AddMonths(-1);
        }

        return months;
    }

    /// <summary>
    /// The UTC instant a local calendar date begins. Where a DST change skips local midnight itself,
    /// the day begins at the first local time that exists (as the device's own calendar does).
    /// </summary>
    private static DateTimeOffset Midnight(DateOnly date, string timeZoneId)
    {
        var timeZone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        var local = date.ToDateTime(TimeOnly.MinValue, DateTimeKind.Unspecified);
        while (timeZone.IsInvalidTime(local))
        {
            local = local.AddMinutes(15);
        }

        return new DateTimeOffset(TimeZoneInfo.ConvertTimeToUtc(local, timeZone));
    }

    private static string DateKey(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
