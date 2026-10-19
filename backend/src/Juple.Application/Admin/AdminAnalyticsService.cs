namespace Juple.Application.Admin;

/// <summary>The Admin Web's analytics (분석). The JupleAdmin policy already authorized the caller; this only validates the range.</summary>
public interface IAdminAnalyticsService
{
    Task<AdminAnalyticsOverview> GetOverviewAsync(string? range, CancellationToken cancellationToken = default);
}

public sealed class AdminAnalyticsService(IAdminAnalyticsStore store, TimeProvider timeProvider) : IAdminAnalyticsService
{
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

        var nowUtc = timeProvider.GetUtcNow();
        return store.GetOverviewAsync(name, days, DateOnly.FromDateTime(nowUtc.UtcDateTime), nowUtc, cancellationToken);
    }
}
