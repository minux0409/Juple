using Juple.Application.Analytics;
using Juple.Domain.Analytics;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Analytics;

public sealed class UserActivityStore(JupleDbContext dbContext) : IUserActivityStore
{
    /// <summary>
    /// One statement. MERGE ... WITH (HOLDLOCK) takes a key-range lock on (UserId, ActivityDateUtc, Platform), so two concurrent
    /// first requests cannot both insert; the unique index UX_UserDailyActivities_User_Date_Platform is the backstop.
    /// LastSeenAtUtc only moves forward; a build already recorded is kept unless a newer request names one.
    /// </summary>
    public async Task RecordAsync(long userId, DateOnly activityDateUtc, ClientPlatform platform, string? appBuild, DateTimeOffset seenAtUtc, CancellationToken cancellationToken = default)
    {
        var date = activityDateUtc.ToDateTime(TimeOnly.MinValue);
        var platformName = platform.ToString();
        var seen = seenAtUtc.ToUniversalTime();
        await dbContext.Database.ExecuteSqlInterpolatedAsync(
            $"""
            MERGE [analytics].[UserDailyActivities] WITH (HOLDLOCK) AS [target]
            USING (SELECT {userId} AS [UserId], CAST({date} AS date) AS [ActivityDateUtc], {platformName} AS [Platform]) AS [source]
                ON [target].[UserId] = [source].[UserId]
                AND [target].[ActivityDateUtc] = [source].[ActivityDateUtc]
                AND [target].[Platform] = [source].[Platform]
            WHEN MATCHED THEN UPDATE SET
                [LastSeenAtUtc] = CASE WHEN {seen} > [target].[LastSeenAtUtc] THEN {seen} ELSE [target].[LastSeenAtUtc] END,
                [AppBuild] = COALESCE({appBuild}, [target].[AppBuild])
            WHEN NOT MATCHED THEN
                INSERT ([UserId], [ActivityDateUtc], [Platform], [AppBuild], [FirstSeenAtUtc], [LastSeenAtUtc])
                VALUES ([source].[UserId], [source].[ActivityDateUtc], [source].[Platform], {appBuild}, {seen}, {seen});
            """,
            cancellationToken);
    }
}
