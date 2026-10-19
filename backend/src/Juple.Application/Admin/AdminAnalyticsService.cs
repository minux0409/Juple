namespace Juple.Application.Admin;

/// <summary>The Admin Web's analytics (분석). The JupleAdmin policy already authorized the caller; this only validates the range.</summary>
public interface IAdminAnalyticsService
{
    Task<AdminAnalyticsOverview> GetOverviewAsync(string? range, CancellationToken cancellationToken = default);

    /// <summary>One account's saved-link counts for 7d / 30d / 90d. An account that does not exist is <see cref="AdminUserNotFoundException"/>.</summary>
    Task<AdminUserLinkStats> GetUserLinkStatsAsync(long userId, string? range, CancellationToken cancellationToken = default);
}

public sealed class AdminAnalyticsService(IAdminAnalyticsStore store, TimeProvider timeProvider, Juple.Application.Billing.BillingOptions billing) : IAdminAnalyticsService
{
    /// <summary>How many top link holders the overview lists (Juple ID + count only).</summary>
    public const int TopHolders = 5;

    /// <summary>The only ranges: the last 7 / 30 / 90 UTC days including today. No free start/end in the first version.</summary>
    public static readonly IReadOnlyDictionary<string, int> Ranges = new Dictionary<string, int>(StringComparer.Ordinal)
    {
        ["7d"] = 7,
        ["30d"] = 30,
        ["90d"] = 90,
    };

    public const string DefaultRange = "30d";

    public Task<AdminAnalyticsOverview> GetOverviewAsync(string? range, CancellationToken cancellationToken = default)
    {
        var name = string.IsNullOrWhiteSpace(range) ? DefaultRange : range.Trim();
        if (!Ranges.TryGetValue(name, out var days))
        {
            throw new InvalidAdminRequestException("range", "range must be 7d, 30d or 90d.");
        }

        return GetAsync(name, days, cancellationToken);
    }

    public async Task<AdminUserLinkStats> GetUserLinkStatsAsync(long userId, string? range, CancellationToken cancellationToken = default)
    {
        var name = string.IsNullOrWhiteSpace(range) ? DefaultRange : range.Trim();
        if (!Ranges.TryGetValue(name, out var days))
        {
            throw new InvalidAdminRequestException("range", "range must be 7d, 30d or 90d.");
        }

        var nowUtc = timeProvider.GetUtcNow();
        var todayUtc = DateOnly.FromDateTime(nowUtc.UtcDateTime);
        return await store.GetUserLinkStatsAsync(userId, name, days, todayUtc, nowUtc, cancellationToken) ?? throw new AdminUserNotFoundException();
    }

    private async Task<AdminAnalyticsOverview> GetAsync(string range, int days, CancellationToken cancellationToken)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var todayUtc = DateOnly.FromDateTime(nowUtc.UtcDateTime);
        var overview = await store.GetOverviewAsync(range, days, todayUtc, nowUtc, cancellationToken);
        // The program's own switch decides whether trial / paid groups exist at all - this never changes a billing setting.
        var programStart = billing.ProgramEnabled ? billing.ProgramStartAtUtc : null;
        var membership = await store.GetMembershipAsync(nowUtc, todayUtc, programStart, cancellationToken);
        var holdings = await store.GetLinkHoldingsAsync(TopHolders, cancellationToken);
        return overview with { Membership = membership, LinkHoldings = holdings };
    }
}
