namespace Juple.Domain.Analytics;

/// <summary>Separate Seoul calendar buckets. UTC aggregates cannot be accurately rebucketed; never backfill by guessing.</summary>
public sealed class UserDailyActivityKst
{
    private UserDailyActivityKst() { }
    public UserDailyActivityKst(long userId, DateOnly date, ClientPlatform platform, DateTimeOffset seen)
    { UserId = userId; Date = date; Platform = platform; LastSeenAtUtc = seen; }
    public long Id { get; private set; }
    public long UserId { get; private set; }
    public DateOnly Date { get; private set; }
    public ClientPlatform Platform { get; private set; }
    public DateTimeOffset LastSeenAtUtc { get; private set; }
}
