using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Application.UrlSafety;
using Juple.Application.UrlSafety.CheckUrlSafety;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// Threat lookup for a user-supplied URL against an external provider (currently Google Web
/// Risk - see WebRiskUrlSafetyChecker) - never a confirmation that a URL is safe, only that no
/// known threat was found at check time (see UrlSafetyStatus.NoKnownThreat). Requires auth like
/// every other endpoint, and additionally rate-limited per user (RateLimiterPolicies.UrlSafetyCheck
/// - see Program.cs) since, unlike URL metadata resolution, each call can incur real external
/// provider cost.
/// </summary>
[ApiController]
[Route("api/v1/url-safety")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[EnableRateLimiting(RateLimiterPolicies.UrlSafetyCheck)]
public sealed class UrlSafetyController : ControllerBase
{
    [HttpPost("check")]
    public async Task<ActionResult<UrlSafetyCheckResponse>> CheckAsync(
        UrlSafetyCheckRequest request,
        [FromServices] ICheckUrlSafetyService checkUrlSafetyService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await checkUrlSafetyService.CheckAsync(
                new CheckUrlSafetyCommand(request.Url), cancellationToken);

            return Ok(new UrlSafetyCheckResponse(ToStatusValue(result.Status), result.Threats.Select(ToThreatValue).ToArray()));
        }
        catch (InvalidUrlSafetyRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    /// <summary>
    /// Explicit string mapping (not enum.ToString()/a JsonStringEnumConverter) so the wire contract
    /// is controlled here in one place and never silently shifts if the enum members are ever
    /// reordered or renamed.
    /// </summary>
    private static string ToStatusValue(UrlSafetyStatus status) => status switch
    {
        UrlSafetyStatus.ThreatDetected => "threatDetected",
        UrlSafetyStatus.NoKnownThreat => "noKnownThreat",
        UrlSafetyStatus.CheckUnavailable => "checkUnavailable",
        _ => "checkUnavailable",
    };

    private static string ToThreatValue(UrlThreatCategory category) => category switch
    {
        UrlThreatCategory.Malware => "malware",
        UrlThreatCategory.SocialEngineering => "socialEngineering",
        UrlThreatCategory.UnwantedSoftware => "unwantedSoftware",
        _ => "other",
    };

    public sealed record UrlSafetyCheckRequest(string? Url);

    public sealed record UrlSafetyCheckResponse(string Status, IReadOnlyList<string> Threats);
}
