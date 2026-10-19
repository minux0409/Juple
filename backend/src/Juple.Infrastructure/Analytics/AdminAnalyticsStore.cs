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

        // Distinct users per (day, platform) - one row per pair, at most 4 x days rows.
        var activeByDayPlatform = (await activity
            .Where(row => row.ActivityDateUtc >= startDate && row.ActivityDateUtc <= todayUtc)
            .GroupBy(row => new { row.ActivityDateUtc, row.Platform })
            .Select(group => new { group.Key.ActivityDateUtc, group.Key.Platform, Count = group.Select(row => row.UserId).Distinct().Count() })
            .ToListAsync(cancellationToken))
            .ToDictionary(row => (row.ActivityDateUtc, row.Platform), row => row.Count);
        int OnDay(DateOnly day, ClientPlatform platform) => activeByDayPlatform.GetValueOrDefault((day, platform));

        // Since tracking started: who has ever been active, overall and per platform.
        var everActive = await activity.Where(row => row.ActivityDateUtc <= todayUtc).Select(row => row.UserId).Distinct().CountAsync(cancellationToken);
        var everByPlatform = await activity
            .Where(row => row.ActivityDateUtc <= todayUtc)
            .GroupBy(row => row.Platform)
            .Select(group => new { Platform = group.Key, Count = group.Select(row => row.UserId).Distinct().Count() })
            .ToDictionaryAsync(row => row.Platform, row => row.Count, cancellationToken);

        var series = new List<AdminAnalyticsDay>(days);
        for (var day = startDate; day <= todayUtc; day = day.AddDays(1))
        {
            series.Add(new AdminAnalyticsDay(
                day,
                signupsByDay.GetValueOrDefault(day),
                activeByDay.GetValueOrDefault(day),
                savedByDay.GetValueOrDefault(day),
                createdByDay.GetValueOrDefault(day))
            {
                ActiveAndroid = OnDay(day, ClientPlatform.Android),
                ActiveIos = OnDay(day, ClientPlatform.Ios),
                ActiveWeb = OnDay(day, ClientPlatform.Web),
                ActiveUnknown = OnDay(day, ClientPlatform.Unknown),
            });
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
            series)
        {
            PlatformsSinceTrackingStart = new AdminAnalyticsPlatforms(
                everActive,
                AllPlatforms.Select(platform => new AdminAnalyticsPlatform(platform.ToString(), everByPlatform.GetValueOrDefault(platform))).ToList()),
        };
    }

    private static readonly ClientPlatform[] AllPlatforms = [ClientPlatform.Android, ClientPlatform.Ios, ClientPlatform.Web, ClientPlatform.Unknown];

    public async Task<AdminMembership> GetMembershipAsync(DateTimeOffset nowUtc, DateOnly todayUtc, DateTimeOffset? programStartAtUtc, CancellationToken cancellationToken = default)
    {
        var users = dbContext.Users.AsNoTracking();
        var todayStart = StartOf(todayUtc);
        var thirtyDaysAgo = nowUtc - Juple.Domain.Billing.TrialPolicy.Duration;
        var total = await users.CountAsync(cancellationToken);
        var newToday = await users.CountAsync(user => user.CreatedAtUtc >= todayStart, cancellationToken);
        // Account age only: created less than exactly 30 x 24 h ago (the same duration the trial uses) vs at/after it.
        var within30 = await users.CountAsync(user => user.CreatedAtUtc > thirtyDaysAgo, cancellationToken);

        AdminMembershipGroups? groups = null;
        if (programStartAtUtc is { } programStart)
        {
            // One row: every account in exactly one group, mirroring EntitlementCalculator.Effective:
            //   live Active/Canceled purchase -> Paid; else live GracePeriod -> GracePeriod; else trial not ended -> InTrial;
            //   else TrialEndedUnpaid. The trial end is the settled one (Users.TrialEndsAtUtc) or, not settled yet, what
            //   TrialPolicy.WindowFor would settle: max(CreatedAtUtc, ProgramStartAtUtc) + 30 x 24 h.
            var now = nowUtc.ToUniversalTime();
            var start = programStart.ToUniversalTime();
            var hours = (int)Juple.Domain.Billing.TrialPolicy.Duration.TotalHours;
            groups = (await dbContext.Database.SqlQuery<MembershipGroupRow>(
                $"""
                SELECT
                    SUM(CASE WHEN [g].[Grp] = 0 THEN 1 ELSE 0 END) AS [Paid],
                    SUM(CASE WHEN [g].[Grp] = 1 THEN 1 ELSE 0 END) AS [GracePeriod],
                    SUM(CASE WHEN [g].[Grp] = 2 THEN 1 ELSE 0 END) AS [InTrial],
                    SUM(CASE WHEN [g].[Grp] = 3 THEN 1 ELSE 0 END) AS [TrialEndedUnpaid]
                FROM (
                    SELECT CASE
                        WHEN EXISTS (SELECT 1 FROM [billing].[StorePurchases] AS [p] WHERE [p].[UserId] = [u].[Id]
                            AND [p].[State] IN ('Active', 'Canceled') AND [p].[AccessEndsAtUtc] > {now}) THEN 0
                        WHEN EXISTS (SELECT 1 FROM [billing].[StorePurchases] AS [p] WHERE [p].[UserId] = [u].[Id]
                            AND [p].[State] = 'GracePeriod' AND [p].[AccessEndsAtUtc] > {now}) THEN 1
                        WHEN {now} < COALESCE([u].[TrialEndsAtUtc],
                            DATEADD(hour, {hours}, CASE WHEN [u].[CreatedAtUtc] < {start} THEN {start} ELSE [u].[CreatedAtUtc] END)) THEN 2
                        ELSE 3
                    END AS [Grp]
                    FROM [users].[Users] AS [u]
                ) AS [g]
                """).ToListAsync(cancellationToken)).Select(row => new AdminMembershipGroups(row.Paid ?? 0, row.GracePeriod ?? 0, row.InTrial ?? 0, row.TrialEndedUnpaid ?? 0)).Single();
        }

        return new AdminMembership(programStartAtUtc is not null, programStartAtUtc, total, newToday, within30, total - within30, groups);
    }

    public async Task<AdminLinkHoldings> GetLinkHoldingsAsync(int topHolders, CancellationToken cancellationToken = default)
    {
        // Every account, LEFT JOINed to its count of live links (trash excluded) - accounts without a link are bucket 0.
        var buckets = await dbContext.Database.SqlQuery<BucketRow>(
            $"""
            SELECT [b].[Bucket] AS [Bucket], COUNT(*) AS [Users], SUM([b].[Cnt]) AS [Links], MAX([b].[Cnt]) AS [MaxCnt]
            FROM (
                SELECT ISNULL([c].[Cnt], 0) AS [Cnt],
                    CASE WHEN [c].[Cnt] IS NULL THEN 0 WHEN [c].[Cnt] < 10 THEN 1 WHEN [c].[Cnt] < 50 THEN 2
                         WHEN [c].[Cnt] < 100 THEN 3 WHEN [c].[Cnt] < 500 THEN 4 ELSE 5 END AS [Bucket]
                FROM [users].[Users] AS [u]
                LEFT JOIN (SELECT [UserId], COUNT(*) AS [Cnt] FROM [items].[Items] WHERE [DeletedAtUtc] IS NULL GROUP BY [UserId]) AS [c]
                    ON [c].[UserId] = [u].[Id]
            ) AS [b]
            GROUP BY [b].[Bucket]
            """).ToListAsync(cancellationToken);

        var max = buckets.Count == 0 ? 0 : buckets.Max(row => row.MaxCnt);
        // Ties are resolved by the oldest account first, so the list is stable; UsersAtMax says how many share the top count.
        var holders = max == 0
            ? []
            : await dbContext.Database.SqlQuery<HolderRow>(
                $"""
                SELECT TOP ({topHolders}) [u].[PublicCode] AS [JupleId], [c].[Cnt] AS [LiveLinks]
                FROM [users].[Users] AS [u]
                JOIN (SELECT [UserId], COUNT(*) AS [Cnt] FROM [items].[Items] WHERE [DeletedAtUtc] IS NULL GROUP BY [UserId]) AS [c] ON [c].[UserId] = [u].[Id]
                ORDER BY [c].[Cnt] DESC, [u].[Id] ASC
                """).ToListAsync(cancellationToken);
        var usersAtMax = max == 0
            ? 0
            : await dbContext.Database.SqlQuery<int>(
                $"""
                SELECT COUNT(*) AS [Value] FROM (SELECT [UserId] FROM [items].[Items] WHERE [DeletedAtUtc] IS NULL GROUP BY [UserId] HAVING COUNT(*) = {max}) AS [m]
                """).SingleAsync(cancellationToken);

        int UsersIn(int bucket) => buckets.FirstOrDefault(row => row.Bucket == bucket)?.Users ?? 0;
        return new AdminLinkHoldings(
            buckets.Sum(row => row.Links),
            buckets.Where(row => row.Bucket > 0).Sum(row => row.Users),
            buckets.Sum(row => row.Users),
            max,
            usersAtMax,
            [
                new AdminLinkBucket(0, 0, UsersIn(0)),
                new AdminLinkBucket(1, 9, UsersIn(1)),
                new AdminLinkBucket(10, 49, UsersIn(2)),
                new AdminLinkBucket(50, 99, UsersIn(3)),
                new AdminLinkBucket(100, 499, UsersIn(4)),
                new AdminLinkBucket(500, null, UsersIn(5)),
            ],
            holders.Select(row => new AdminLinkHolder(row.JupleId, row.LiveLinks)).ToList());
    }

    private sealed class MembershipGroupRow
    {
        public int? Paid { get; init; }

        public int? GracePeriod { get; init; }

        public int? InTrial { get; init; }

        public int? TrialEndedUnpaid { get; init; }
    }

    private sealed class BucketRow
    {
        public int Bucket { get; init; }

        public int Users { get; init; }

        public int Links { get; init; }

        public int MaxCnt { get; init; }
    }

    private sealed class HolderRow
    {
        public string JupleId { get; init; } = "";

        public int LiveLinks { get; init; }
    }

    private static Task<int> DistinctUsersAsync(IQueryable<UserDailyActivity> activity, DateOnly from, DateOnly to, CancellationToken cancellationToken) =>
        activity
            .Where(row => row.ActivityDateUtc >= from && row.ActivityDateUtc <= to)
            .Select(row => row.UserId)
            .Distinct()
            .CountAsync(cancellationToken);

    private static DateTimeOffset StartOf(DateOnly day) => new(day.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
}
