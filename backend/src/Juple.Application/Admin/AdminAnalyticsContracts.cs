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
    IReadOnlyList<AdminAnalyticsDay> Series)
{
    /// <summary>회원 상태 (Round 6, additive). Range-independent: "now" in UTC.</summary>
    public AdminMembership? Membership { get; init; }

    /// <summary>현재 링크 보유량 (Round 6, additive) - live links per account right now, NOT the saved-per-day activity series.</summary>
    public AdminLinkHoldings? LinkHoldings { get; init; }

    /// <summary>Distinct active users per platform since activity tracking started (Round 6, additive).</summary>
    public AdminAnalyticsPlatforms? PlatformsSinceTrackingStart { get; init; }
}

/// <summary>
/// Membership (회원 상태) - exact counts from users.Users and billing.StorePurchases. While the billing program is not running
/// (Billing:ProgramEnabled=false) nobody has a trial or needs a subscription, so the entitlement groups are null ("결제 미운영 / 집계
/// 불가") - never 0 and never a projection. <see cref="SignedUpWithin30Days"/> / <see cref="SignedUpOver30Days"/> are the account's
/// age only (CreatedAtUtc, exactly 30 x 24 h), never a trial or payment state.
/// </summary>
public sealed record AdminMembership(
    bool BillingProgramEnabled,
    DateTimeOffset? ProgramStartAtUtc,
    int TotalUsers,
    int NewToday,
    int SignedUpWithin30Days,
    int SignedUpOver30Days,
    AdminMembershipGroups? Groups);

/// <summary>
/// The four exclusive groups when the program runs, in the entitlement calculator's own order: a live paid purchase (Active or
/// Canceled-but-not-yet-ended) -> Paid; else only a live grace period -> GracePeriod; else a trial window not yet ended -> InTrial;
/// else -> TrialEndedUnpaid (the read-only state). They add up to TotalUsers.
/// </summary>
public sealed record AdminMembershipGroups(int Paid, int GracePeriod, int InTrial, int TrialEndedUnpaid);

/// <summary>
/// Live links (not in the trash) held per account right now, over EVERY account (an account with no link counts as 0). Holders are
/// shown by Juple ID only - never a URL, title or memo.
/// </summary>
public sealed record AdminLinkHoldings(
    int TotalLiveLinks,
    int UsersWithLinks,
    int TotalUsers,
    int MaxLinksPerUser,
    int UsersAtMax,
    IReadOnlyList<AdminLinkBucket> Buckets,
    IReadOnlyList<AdminLinkHolder> TopHolders);

/// <summary>[Min, Max] live links per account, inclusive; Max null = open-ended.</summary>
public sealed record AdminLinkBucket(int Min, int? Max, int Users);

public sealed record AdminLinkHolder(string JupleId, int LiveLinks);

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
public sealed record AdminAnalyticsDay(DateOnly Date, int Signups, int ActiveUsers, int LinksSaved, int CollectionsCreated)
{
    /// <summary>Distinct active users per platform on that day (Round 6, additive; a person on two platforms is in both).</summary>
    public int ActiveAndroid { get; init; }

    public int ActiveIos { get; init; }

    public int ActiveWeb { get; init; }

    public int ActiveUnknown { get; init; }
}

public interface IAdminAnalyticsStore
{
    Task<AdminAnalyticsOverview> GetOverviewAsync(string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>회원 상태 now. programStartAtUtc null = the billing program is not running (no entitlement groups).</summary>
    Task<AdminMembership> GetMembershipAsync(DateTimeOffset nowUtc, DateOnly todayUtc, DateTimeOffset? programStartAtUtc, CancellationToken cancellationToken = default);

    Task<AdminLinkHoldings> GetLinkHoldingsAsync(int topHolders, CancellationToken cancellationToken = default);
}
