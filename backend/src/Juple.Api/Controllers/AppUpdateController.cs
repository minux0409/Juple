using Juple.Api.Configuration;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Juple.Api.Controllers;

/// <summary>
/// The app-update policy for one platform, readable WITHOUT signing in - so a build that must update is told so on the sign-in
/// screen too, and an update prompt never depends on a working session. It exposes exactly what the bootstrap response already
/// carries for that platform (<see cref="MobileVersionPolicyOptions"/>, the single source): build numbers and a public store URL.
/// No account, device or secret is involved, nothing is read from the database, and the answer is tiny, so there is no per-caller
/// limiter (behind the platform proxy a per-IP key would put every user in one bucket). It is read-only: an anonymous GET is not a
/// mutation and needs no review entry.
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/v1/app-update")]
public sealed class AppUpdateController(IOptions<MobileVersionPolicyOptions> options) : ControllerBase
{
    [HttpGet("{platform}")]
    public IActionResult Get(string platform)
    {
        var policy = ResolvePlatform(options.Value, platform);
        if (policy is null)
        {
            return NotFound();
        }

        // Short shared caching: a policy change reaches clients within a minute, and a burst of foregrounding costs nothing.
        Response.Headers.CacheControl = "public, max-age=60";
        return Ok(AppUpdatePolicyResponse.From(platform.ToLowerInvariant(), policy));
    }

    private static MobilePlatformVersionPolicy? ResolvePlatform(MobileVersionPolicyOptions options, string platform) =>
        platform.ToLowerInvariant() switch
        {
            "android" => options.Android,
            "ios" => options.Ios,
            _ => null,
        };

    /// <summary>
    /// Enabled is derived (a platform at 0 / 0 has no policy) - there is deliberately no second switch that could contradict the
    /// build numbers. The builds are the platform's own build numbers (Android versionCode / iOS CFBundleVersion).
    /// </summary>
    public sealed record AppUpdatePolicyResponse(string Platform, bool Enabled, int LatestBuild, int MinimumSupportedBuild, string? StoreUrl)
    {
        public static AppUpdatePolicyResponse From(string platform, MobilePlatformVersionPolicy policy)
        {
            var enabled = policy.LatestBuild > 0 || policy.MinimumSupportedBuild > 0;
            return new(
                platform,
                enabled,
                enabled ? policy.LatestBuild : 0,
                enabled ? policy.MinimumSupportedBuild : 0,
                enabled && !string.IsNullOrWhiteSpace(policy.StoreUrl) ? policy.StoreUrl.Trim() : null);
        }
    }
}
