using Juple.Application.Admin;
using Juple.Domain.Analytics;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Analytics;

/// <summary>
/// 분석 numbers as SQL aggregates - COUNT / COUNT(DISTINCT) and GROUP BY the UTC date; only one row per day and per platform comes
/// back, never the underlying rows. The day series are filled with zeros in memory (at most 90 entries).
/// </summary>
public sealed class AdminAnalyticsStore(JupleDbContext dbContext) : IAdminAnalyticsStore
{
    public async Task<AdminAnalyticsOverview> GetOverviewAsync(string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var startDate = todayUtc.AddDays(-(days - 1));
        var todayStart = StartOf(todayUtc);
        var tomorrowStart = StartOf(todayUtc.AddDays(1));
        var rangeStart = StartOf(startDate);
        var sevenStart = StartOf(todayUtc.AddDays(-6));
        var thirtyStart = StartOf(todayUtc.AddDays(-29));

        // ---- users (signups from Users.CreatedAtUtc) ----
        var users = dbContext.Users.AsNoTracking();
        var totalUsers = await users.CountAsync(cancellationToken);
        var newToday = await users.CountAsync(user => user.CreatedAtUtc >= todayStart && user.CreatedAtUtc < tomorrowStart, cancellationToken);
        var new7 = await users.CountAsync(user => user.CreatedAtUtc >= sevenStart && user.CreatedAtUtc < tomorrowStart, cancellationToken);
        var new30 = await users.CountAsync(user => user.CreatedAtUtc >= thirtyStart && user.CreatedAtUtc < tomorrowStart, cancellationToken);
        var signupsByDay = await users
            .Where(user => user.CreatedAtUtc >= rangeStart && user.CreatedAtUtc < tomorrowStart)
            .GroupBy(user => user.CreatedAtUtc.Date)
            .Select(group => new { Day = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);

        // ---- activity (analytics.UserDailyActivities) ----
        var activity = dbContext.UserDailyActivities.AsNoTracking();
        var trackingSince = await activity.Select(row => (DateOnly?)row.ActivityDateUtc).MinAsync(cancellationToken);
        var dau = await DistinctUsersAsync(activity, todayUtc, todayUtc, cancellationToken);
        var wau = await DistinctUsersAsync(activity, todayUtc.AddDays(-6), todayUtc, cancellationToken);
        var mau = await DistinctUsersAsync(activity, todayUtc.AddDays(-29), todayUtc, cancellationToken);
        var activeInRange = await DistinctUsersAsync(activity, startDate, todayUtc, cancellationToken);
        var activeByDay = await activity
            .Where(row => row.ActivityDateUtc >= startDate && row.ActivityDateUtc <= todayUtc)
            .GroupBy(row => row.ActivityDateUtc)
            .Select(group => new { Day = group.Key, Count = group.Select(row => row.UserId).Distinct().Count() })
            .ToDictionaryAsync(row => row.Day, row => row.Count, cancellationToken);
        var activeByPlatform = await activity
            .Where(row => row.ActivityDateUtc >= startDate && row.ActivityDateUtc <= todayUtc)
            .GroupBy(row => row.Platform)
            .Select(group => new { Platform = group.Key, Count = group.Select(row => row.UserId).Distinct().Count() })
            .ToDictionaryAsync(row => row.Platform, row => row.Count, cancellationToken);

        // ---- links (Items.SavedAtUtc; trash included, permanently deleted links are gone) ----
        var items = dbContext.Items.AsNoTracking();
        var totalLinks = await items.CountAsync(item => item.DeletedAtUtc == null, cancellationToken);
        var savedToday = await items.CountAsync(item => item.SavedAtUtc >= todayStart && item.SavedAtUtc < tomorrowStart, cancellationToken);
        var saved7 = await items.CountAsync(item => item.SavedAtUtc >= sevenStart && item.SavedAtUtc < tomorrowStart, cancellationToken);
        var saved30 = await items.CountAsync(item => item.SavedAtUtc >= thirtyStart && item.SavedAtUtc < tomorrowStart, cancellationToken);
        var savedInRange = items.Where(item => item.SavedAtUtc >= rangeStart && item.SavedAtUtc < tomorrowStart);
        var uniqueSavers = await savedInRange.Select(item => item.UserId).Distinct().CountAsync(cancellationToken);
        var savedByDay = await savedInRange
            .GroupBy(item => item.SavedAtUtc.Date)
            .Select(group => new { Day = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);

        // ---- collections (Collections.CreatedAtUtc; soft-deleted ones count until they are purged) ----
        var allCollections = dbContext.Collections.AsNoTracking();
        var liveCollections = allCollections.Where(collection => collection.DeletedAtUtc == null);
        var totalCollections = await liveCollections.CountAsync(cancellationToken);
        var sharedCollections = await liveCollections.CountAsync(
            collection =>
                dbContext.CollectionCollaborators.Any(member => member.CollectionId == collection.Id)
                || dbContext.CollectionShares.Any(share => share.CollectionId == collection.Id && share.IsActive),
            cancellationToken);
        var created7 = await allCollections.CountAsync(collection => collection.CreatedAtUtc >= sevenStart && collection.CreatedAtUtc < tomorrowStart, cancellationToken);
        var created30 = await allCollections.CountAsync(collection => collection.CreatedAtUtc >= thirtyStart && collection.CreatedAtUtc < tomorrowStart, cancellationToken);
        var createdByDay = await allCollections
            .Where(collection => collection.CreatedAtUtc >= rangeStart && collection.CreatedAtUtc < tomorrowStart)
            .GroupBy(collection => collection.CreatedAtUtc.Date)
            .Select(group => new { Day = group.Key, Count = group.Count() })
            .ToDictionaryAsync(row => DateOnly.FromDateTime(row.Day), row => row.Count, cancellationToken);

        var series = new List<AdminAnalyticsDay>(days);
        for (var day = startDate; day <= todayUtc; day = day.AddDays(1))
        {
            series.Add(new AdminAnalyticsDay(
                day,
                signupsByDay.GetValueOrDefault(day),
                activeByDay.GetValueOrDefault(day),
                savedByDay.GetValueOrDefault(day),
                createdByDay.GetValueOrDefault(day)));
        }

        var platforms = new[] { ClientPlatform.Android, ClientPlatform.Ios, ClientPlatform.Web, ClientPlatform.Unknown }
            .Select(platform => new AdminAnalyticsPlatform(platform.ToString(), activeByPlatform.GetValueOrDefault(platform)))
            .ToList();

        return new AdminAnalyticsOverview(
            range,
            startDate,
            todayUtc,
            nowUtc,
            trackingSince,
            new AdminAnalyticsUsers(totalUsers, newToday, new7, new30, series.Sum(day => day.Signups), dau, wau, mau),
            new AdminAnalyticsLinks(totalLinks, savedToday, saved7, saved30, series.Sum(day => day.LinksSaved), uniqueSavers),
            new AdminAnalyticsCollections(totalCollections, sharedCollections, created7, created30, series.Sum(day => day.CollectionsCreated)),
            new AdminAnalyticsPlatforms(activeInRange, platforms),
            new AdminAnalyticsCountries(Available: false),
            series);
    }

    private static Task<int> DistinctUsersAsync(IQueryable<UserDailyActivity> activity, DateOnly from, DateOnly to, CancellationToken cancellationToken) =>
        activity
            .Where(row => row.ActivityDateUtc >= from && row.ActivityDateUtc <= to)
            .Select(row => row.UserId)
            .Distinct()
            .CountAsync(cancellationToken);

    private static DateTimeOffset StartOf(DateOnly day) => new(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
}
