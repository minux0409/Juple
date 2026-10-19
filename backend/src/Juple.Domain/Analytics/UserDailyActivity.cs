namespace Juple.Domain.Analytics;

/// <summary>Where an authenticated request came from. Stored by name; a value is only ever appended.</summary>
public enum ClientPlatform
{
    /// <summary>A client this API could not attribute (no platform header and an unrecognized HTTP stack).</summary>
    Unknown,
    Android,
    Ios,
    Web,
}

/// <summary>
/// "This person used Juple on this platform on this UTC day" - the only activity record kept (docs/analytics.md). One row per
/// (user, UTC date, platform), however many requests that day made: the first request inserts it, later ones only move
/// LastSeenAtUtc (at most once an hour per API instance). No IP address, User-Agent, device id, token or location is stored.
/// Deleted together with the account (FK cascade).
/// </summary>
public sealed class UserDailyActivity
{
    private UserDailyActivity()
    {
    }

    public UserDailyActivity(long userId, DateOnly activityDateUtc, ClientPlatform platform, string? appBuild, DateTimeOffset seenAtUtc)
    {
        UserId = userId;
        ActivityDateUtc = activityDateUtc;
        Platform = platform;
        AppBuild = appBuild;
        FirstSeenAtUtc = seenAtUtc;
        LastSeenAtUtc = seenAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    /// <summary>The UTC calendar day of the activity (analytics days are UTC days).</summary>
    public DateOnly ActivityDateUtc { get; private set; }

    public ClientPlatform Platform { get; private set; }

    /// <summary>The app's own build number (Android versionCode / iOS CFBundleVersion) when the client sent one; null for the Web.</summary>
    public string? AppBuild { get; private set; }

    public DateTimeOffset FirstSeenAtUtc { get; private set; }

    public DateTimeOffset LastSeenAtUtc { get; private set; }
}
