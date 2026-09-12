using Juple.Api.Authentication;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlMetadata.ResolveUrlMetadata;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// Best-effort URL title backfill for Items with no title from any other source (Incoming Share
/// Intent title, shared-text leading title, or user input) - see
/// docs "URL Metadata / 자동 제목 추출". Requires auth like every other endpoint, partly to keep this
/// server-side outbound-fetch capability from being usable by an unauthenticated caller.
/// </summary>
[ApiController]
[Route("api/v1/url-metadata")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class UrlMetadataController : ControllerBase
{
    [HttpPost("resolve")]
    public async Task<ActionResult<ResolveUrlMetadataResponse>> ResolveAsync(
        ResolveUrlMetadataRequest request,
        [FromServices] IResolveUrlMetadataService resolveUrlMetadataService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await resolveUrlMetadataService.ResolveAsync(
                new ResolveUrlMetadataCommand(request.Url), cancellationToken);

            return Ok(new ResolveUrlMetadataResponse(result.Title, result.Source?.ToString()));
        }
        catch (InvalidUrlMetadataRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record ResolveUrlMetadataRequest(string? Url);

    public sealed record ResolveUrlMetadataResponse(string? Title, string? Source);
}
