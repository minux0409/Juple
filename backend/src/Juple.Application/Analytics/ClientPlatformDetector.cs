using System.Text.RegularExpressions;
using Juple.Domain.Analytics;

namespace Juple.Application.Analytics;

/// <summary>
/// Which client platform an authenticated request came from - for analytics only, never for access. The mobile app names itself
/// in <see cref="PlatformHeader"/> (a closed set; anything else is ignored). Without it (installed builds that predate the header,
/// and every browser) the platform is read from the HTTP stack's User-Agent in memory - React Native's networking is OkHttp on
/// Android and CFNetwork on iOS, a browser says "Mozilla/". The User-Agent itself is never stored, logged or returned.
/// </summary>
public static partial class ClientPlatformDetector
{
    public const string PlatformHeader = "X-Juple-Platform";

    public const string AppBuildHeader = "X-Juple-App-Build";

    public static ClientPlatform Detect(string? platformHeader, string? userAgent)
    {
        switch (platformHeader?.Trim().ToLowerInvariant())
        {
            case "android":
                return ClientPlatform.Android;
            case "ios":
                return ClientPlatform.Ios;
            case "web":
                return ClientPlatform.Web;
        }

        if (string.IsNullOrWhiteSpace(userAgent))
        {
            return ClientPlatform.Unknown;
        }

        if (userAgent.Contains("okhttp", StringComparison.OrdinalIgnoreCase))
        {
            return ClientPlatform.Android;
        }

        if (userAgent.Contains("CFNetwork", StringComparison.OrdinalIgnoreCase) || userAgent.Contains("Darwin/", StringComparison.OrdinalIgnoreCase))
        {
            return ClientPlatform.Ios;
        }

        return userAgent.StartsWith("Mozilla/", StringComparison.Ordinal) ? ClientPlatform.Web : ClientPlatform.Unknown;
    }

    /// <summary>The app build as the client sent it - letters, digits, '.', '_' and '-' only, at most 32 characters; otherwise null.</summary>
    public static string? NormalizeAppBuild(string? value)
    {
        var trimmed = value?.Trim();
        return !string.IsNullOrEmpty(trimmed) && BuildPattern().IsMatch(trimmed) ? trimmed : null;
    }

    [GeneratedRegex("^[0-9A-Za-z._-]{1,32}$")]
    private static partial Regex BuildPattern();
}
