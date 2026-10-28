using Juple.Application.Admin;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Analytics;

/// <summary>
/// SQL aggregates for the Admin Web's dashboard and user screens: counts and grouped counts only - no link URL, title, memo or
/// image ever leaves this store, and no list of users or links is loaded to compute a number.
/// </summary>
public sealed class AdminInsightsStore(JupleDbContext db) : IAdminInsightsStore
{
    public async Task<AdminDashboardKpis> KpisAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var today = AdminDateRange.SeoulDate(nowUtc);
        var todayStart = new AdminDateRange(today, today).StartUtc;
        var users = db.Users.AsNoTracking();
        var total = await users.CountAsync(cancellationToken);
        var todaySignups = await users.CountAsync(user => user.CreatedAtUtc >= todayStart, cancellationToken);
        var liveLinks = await db.Items.AsNoTracking().CountAsync(item => item.DeletedAtUtc == null, cancellationToken);
        return new AdminDashboardKpis(total, liveLinks, todaySignups, today, AdminInsightsDefinitions.TimeZone, nowUtc);
    }

    public async Task<AdminMetricSeries> SeriesAsync(string metric, AdminDateRange period, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var start = period.StartUtc;
        var end = period.EndExclusiveUtc;
        IReadOnlyList<AdminMetricPoint> points;
        string definition;
        switch (metric)
        {
            case "users":
            {
                var before = await db.Users.AsNoTracking().CountAsync(user => user.CreatedAtUtc < start, cancellationToken);
                var daily = await SignupsByDayAsync(start, end, cancellationToken);
                points = Running(period, before, day => daily.GetValueOrDefault(day));
                definition = AdminInsightsDefinitions.Users;
                break;
            }

            case "links":
            {
                var items = db.Items.AsNoTracking();
                // Live at the end of the day before the period: saved before it and not in the trash at that moment.
                var before = await items.CountAsync(item => item.SavedAtUtc < start && (item.DeletedAtUtc == null || item.DeletedAtUtc >= start), cancellationToken);
                var saved = await items
                    .Where(item => item.SavedAtUtc >= start && item.SavedAtUtc < end)
                    .GroupBy(item => item.SavedAtUtc.AddHours(9).Date)
                    .Select(group => new { Day = group.Key, Count = group.Count() })
                    .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);
                var trashed = await items
                    .Where(item => item.DeletedAtUtc >= start && item.DeletedAtUtc < end)
                    .GroupBy(item => item.DeletedAtUtc!.Value.AddHours(9).Date)
                    .Select(group => new { Day = group.Key, Count = group.Count() })
                    .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);
                points = Running(period, before, day => saved.GetValueOrDefault(day) - trashed.GetValueOrDefault(day));
                definition = AdminInsightsDefinitions.Links;
                break;
            }

            default:
            {
                var daily = await SignupsByDayAsync(start, end, cancellationToken);
                points = Days(period).Select(day => new AdminMetricPoint(day, daily.GetValueOrDefault(day))).ToArray();
                definition = AdminInsightsDefinitions.Signups;
                break;
            }
        }

        return new AdminMetricSeries(metric, period.From, period.Through, AdminInsightsDefinitions.TimeZone, nowUtc, points, definition);
    }

    public async Task<AdminUserDirectoryPage> UsersAsync(AdminUserDirectoryQuery query, CancellationToken cancellationToken = default)
    {
        var users = db.Users.AsNoTracking();
        if (query.Search is { } search)
        {
            users = query.SearchField == AdminUserSearchField.JupleId
                ? users.Where(user => user.PublicCode.StartsWith(search))
                : users.Where(user => user.DisplayName != null && user.DisplayName.Contains(search));
        }

        if (query.Language is { } language)
        {
            var withRegion = language + "-";
            var withUnderscore = language + "_";
            users = users.Where(user => user.PreferredLocale == language || user.PreferredLocale.StartsWith(withRegion) || user.PreferredLocale.StartsWith(withUnderscore));
        }

        var total = await users.CountAsync(cancellationToken);
        // One query for the page: the link count is a correlated COUNT on the UserId index (no N+1, no list of links loaded).
        var rows = users.Select(user => new
        {
            user.Id,
            user.PublicCode,
            user.DisplayName,
            user.PreferredLocale,
            user.CreatedAtUtc,
            Links = db.Items.Count(item => item.UserId == user.Id && item.DeletedAtUtc == null),
        });
        rows = query.Sort switch
        {
            AdminUserSort.CreatedAsc => rows.OrderBy(row => row.CreatedAtUtc).ThenBy(row => row.Id),
            AdminUserSort.LinksDesc => rows.OrderByDescending(row => row.Links).ThenByDescending(row => row.Id),
            AdminUserSort.LinksAsc => rows.OrderBy(row => row.Links).ThenBy(row => row.Id),
            _ => rows.OrderByDescending(row => row.CreatedAtUtc).ThenByDescending(row => row.Id),
        };
        var page = await rows.Skip((query.Page - 1) * query.PageSize).Take(query.PageSize).ToListAsync(cancellationToken);

        // The language filter's choices: every stored locale (a few dozen distinct values) folded to its primary subtag.
        var locales = await db.Users.AsNoTracking()
            .GroupBy(user => user.PreferredLocale)
            .Select(group => new { Locale = group.Key, Count = group.Count() })
            .ToListAsync(cancellationToken);
        var languages = locales
            .GroupBy(row => PrimaryLanguage(row.Locale))
            .Select(group => new AdminLanguageCount(group.Key, group.Sum(row => row.Count)))
            .OrderByDescending(row => row.Users)
            .ThenBy(row => row.Language, StringComparer.Ordinal)
            .ToArray();

        return new AdminUserDirectoryPage(
            page.Select(row => new AdminUserDirectoryRow(row.Id, row.PublicCode, row.DisplayName, row.Links, row.PreferredLocale, PrimaryLanguage(row.PreferredLocale), row.CreatedAtUtc)).ToArray(),
            query.Page,
            query.PageSize,
            total,
            languages);
    }

    public async Task<AdminUserLinkHistory?> UserLinkHistoryAsync(long userId, bool monthly, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var person = await db.Users.AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new { user.PublicCode, user.DisplayName, user.CreatedAtUtc })
            .SingleOrDefaultAsync(cancellationToken);
        if (person is null)
        {
            return null;
        }

        var signupDate = AdminDateRange.SeoulDate(person.CreatedAtUtc);
        var today = AdminDateRange.SeoulDate(nowUtc);
        if (today < signupDate)
        {
            today = signupDate;
        }

        var period = new AdminDateRange(signupDate, today);
        var useMonths = monthly || period.Days > AdminInsightsService.MaxDailyBuckets;
        var start = period.StartUtc;
        var items = db.Items.AsNoTracking().Where(item => item.UserId == userId);
        // Nothing before the sign-up day is shown, and every day after it has a value (0 when nothing was saved).
        var byDay = await items
            .Where(item => item.SavedAtUtc >= start)
            .GroupBy(item => item.SavedAtUtc.AddHours(9).Date)
            .Select(group => new { Day = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);
        var live = await items.CountAsync(item => item.DeletedAtUtc == null, cancellationToken);

        var buckets = new List<AdminUserLinkBucket>();
        var cumulative = 0;
        if (useMonths)
        {
            for (var month = new DateOnly(signupDate.Year, signupDate.Month, 1); month <= today; month = month.AddMonths(1))
            {
                var bucketStart = month < signupDate ? signupDate : month;
                var saved = byDay.Where(pair => pair.Key >= bucketStart && pair.Key < month.AddMonths(1)).Sum(pair => pair.Value);
                cumulative += saved;
                buckets.Add(new AdminUserLinkBucket(bucketStart, saved, cumulative));
            }
        }
        else
        {
            foreach (var day in Days(period))
            {
                var saved = byDay.GetValueOrDefault(day);
                cumulative += saved;
                buckets.Add(new AdminUserLinkBucket(day, saved, cumulative));
            }
        }

        return new AdminUserLinkHistory(
            userId,
            person.PublicCode,
            person.DisplayName,
            person.CreatedAtUtc,
            signupDate,
            today,
            useMonths ? "month" : "day",
            live,
            cumulative,
            buckets,
            AdminInsightsDefinitions.TimeZone,
            nowUtc);
    }

    /// <summary>"ko-KR" -> "ko", "zh_Hant_TW" -> "zh"; an empty locale is "und" (undetermined).</summary>
    public static string PrimaryLanguage(string? locale)
    {
        var primary = (locale ?? string.Empty).Split('-', '_')[0].Trim().ToLowerInvariant();
        return primary.Length == 0 ? "und" : primary;
    }

    private async Task<Dictionary<DateOnly, int>> SignupsByDayAsync(DateTimeOffset start, DateTimeOffset end, CancellationToken cancellationToken) =>
        await db.Users.AsNoTracking()
            .Where(user => user.CreatedAtUtc >= start && user.CreatedAtUtc < end)
            .GroupBy(user => user.CreatedAtUtc.AddHours(9).Date)
            .Select(group => new { Day = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);

    private static IEnumerable<DateOnly> Days(AdminDateRange period)
    {
        for (var day = period.From; day <= period.Through; day = day.AddDays(1))
        {
            yield return day;
        }
    }

    private static AdminMetricPoint[] Running(AdminDateRange period, int before, Func<DateOnly, int> change)
    {
        var value = before;
        return Days(period).Select(day =>
        {
            value += change(day);
            return new AdminMetricPoint(day, value);
        }).ToArray();
    }
}
