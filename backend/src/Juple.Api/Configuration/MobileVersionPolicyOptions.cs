namespace Juple.Api.Configuration;

/// <summary>
/// Bound from the "MobileVersionPolicy" configuration section: which installed BUILD of the mobile app is current, which is the
/// oldest still supported, and where each platform's store page is. The apps carry no version policy of their own - they compare
/// their own build number (Android versionCode / iOS CFBundleVersion) with this, delivered in the existing bootstrap response, so
/// an update prompt is a server-side configuration change, never an app release.
///
/// Build numbers are authoritative; display version strings are not part of the policy. A platform left at 0 / 0 has no policy
/// (no prompt). Operations rule: never set a build here before that build can actually be downloaded from the store, or users
/// would be told to update to a version the store cannot deliver.
/// </summary>
public sealed class MobileVersionPolicyOptions
{
    public MobilePlatformVersionPolicy Android { get; set; } = new();

    public MobilePlatformVersionPolicy Ios { get; set; } = new();

    /// <summary>The first problem with the configuration, or null when it is usable (the API refuses to start otherwise).</summary>
    public string? Validate() => Android.Validate("Android") ?? Ios.Validate("Ios");
}

public sealed class MobilePlatformVersionPolicy
{
    /// <summary>The newest build available in the store; 0 = no policy.</summary>
    public int LatestBuild { get; set; }

    /// <summary>The oldest build still allowed to run; an installed build below it must update. 0 = nothing is forced.</summary>
    public int MinimumSupportedBuild { get; set; }

    /// <summary>The store page (https). Optional: the Android app falls back to its own Play listing; iOS needs the real App Store URL.</summary>
    public string? StoreUrl { get; set; }

    public string? Validate(string platform)
    {
        if (LatestBuild < 0 || MinimumSupportedBuild < 0)
        {
            return $"MobileVersionPolicy:{platform} builds cannot be negative.";
        }

        if (MinimumSupportedBuild > LatestBuild)
        {
            return $"MobileVersionPolicy:{platform}:MinimumSupportedBuild cannot be above LatestBuild.";
        }

        if (!string.IsNullOrWhiteSpace(StoreUrl)
            && !(Uri.TryCreate(StoreUrl, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps))
        {
            return $"MobileVersionPolicy:{platform}:StoreUrl must be an absolute https URL.";
        }

        return null;
    }
}
