namespace Juple.Application.Admin;

/// <summary>
/// 분석 - every number of the Admin Web's analytics pages in one answer (docs/analytics.md has the definitions). Days are UTC days.
/// DAU / WAU / MAU are DISTINCT users over 1 / 7 / 30 UTC days ending today - never sums of daily counts - and only exist from
/// <see cref="ActivityTrackingSince"/> on (nothing before it is estimated).
/// </summary>
public sealed record AdminAnalyticsOverview(
    string Range,
    DateOnly StartDateUtc,
    DateOnly TodayUtc,
    DateTimeOffset GeneratedAtUtc,
    DateOnly? ActivityTrackingSince,
    AdminAnalyticsUsers Users,
    AdminAnalyticsLinks Links,
    AdminAnalyticsCollections Collections,
    AdminAnalyticsPlatforms Platforms,
    AdminAnalyticsCountries Countries,
    IReadOnlyList<AdminAnalyticsDay> Series);

/// <param name="Total">Existing accounts (a deleted account is removed).</param>
/// <param name="NewInRange">Accounts created in the selected range.</param>
/// <param name="Dau">Distinct active users today (UTC).</param>
/// <param name="Wau">Distinct active users in the last 7 UTC days including today.</param>
/// <param name="Mau">Distinct active users in the last 30 UTC days including today.</param>
public sealed record AdminAnalyticsUsers(int Total, int NewToday, int New7Days, int New30Days, int NewInRange, int Dau, int Wau, int Mau);

/// <param name="TotalLive">Links not in the trash (the dashboard's number).</param>
/// <param name="SavedInRange">Links saved in the range that still exist (in the trash or not); permanently deleted ones are gone.</param>
/// <param name="UniqueSaversInRange">Distinct people who saved at least one of those links.</param>
public sealed record AdminAnalyticsLinks(int TotalLive, int SavedToday, int Saved7Days, int Saved30Days, int SavedInRange, int UniqueSaversInRange);

/// <param name="TotalLive">Collections that are not deleted.</param>
/// <param name="SharedLive">Of those, the ones with a member or an active share link (the dashboard's definition).</param>
/// <param name="CreatedInRange">Collections created in the range that still exist (deleted ones included until they are purged).</param>
public sealed record AdminAnalyticsCollections(int TotalLive, int SharedLive, int Created7Days, int Created30Days, int CreatedInRange);

/// <param name="ActiveUsersInRange">Distinct active users in the range over all platforms (a person on two platforms counts once).</param>
/// <param name="Items">Distinct active users per platform in the range (a person on two platforms is in both).</param>
public sealed record AdminAnalyticsPlatforms(int ActiveUsersInRange, IReadOnlyList<AdminAnalyticsPlatform> Items);

public sealed record AdminAnalyticsPlatform(string Platform, int ActiveUsers);

/// <summary>No country is collected yet (no trusted source - docs/analytics.md); <see cref="Available"/> stays false until one exists.</summary>
public sealed record AdminAnalyticsCountries(bool Available);

/// <summary>One UTC day of the range. ActiveUsers is 0 before activity tracking started.</summary>
public sealed record AdminAnalyticsDay(DateOnly Date, int Signups, int ActiveUsers, int LinksSaved, int CollectionsCreated);

public interface IAdminAnalyticsStore
{
    Task<AdminAnalyticsOverview> GetOverviewAsync(string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}
