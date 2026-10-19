using Juple.Domain.Analytics;

namespace Juple.Application.Analytics;

public interface IUserActivityStore
{
    /// <summary>
    /// Records that the user was active on this UTC day and platform: inserts the day's row, or only moves its LastSeenAtUtc (and
    /// fills a missing build). Idempotent and safe under concurrency - one row per (user, day, platform) whatever the interleaving.
    /// </summary>
    Task RecordAsync(long userId, DateOnly activityDateUtc, ClientPlatform platform, string? appBuild, DateTimeOffset seenAtUtc, CancellationToken cancellationToken = default);
}
