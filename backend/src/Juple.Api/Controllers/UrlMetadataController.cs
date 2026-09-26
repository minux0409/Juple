using Juple.Api.Authentication;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlMetadata.PreviewInstagramMetadataCandidate;
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

            return Ok(new ResolveUrlMetadataResponse(result.Title, result.Source?.ToString(), result.PreviewImageUrl));
        }
        catch (InvalidUrlMetadataRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    /// <summary>
    /// Pre-save display of a device-fetched Instagram candidate (NewLinkReview, before any Item
    /// exists): the same server-side validation/normalization as the Item-scoped
    /// items/{id}/instagram-metadata-candidate endpoint, checked against the reviewed URL instead of a
    /// saved Item. Read-only - persists nothing; the saved Item still gets its metadata through that
    /// Item-scoped endpoint. No outbound fetch happens here (the device already fetched the page).
    /// </summary>
    [HttpPost("instagram-candidate-preview")]
    public ActionResult<InstagramCandidatePreviewResponse> PreviewInstagramCandidate(
        InstagramCandidatePreviewRequest request,
        [FromServices] IPreviewInstagramMetadataCandidateService previewService)
    {
        try
        {
            var result = previewService.Preview(new PreviewInstagramMetadataCandidateCommand(
                request.SourceUrl,
                new InstagramMetadataCandidateCommand(request.OgTitle, request.OgImage, request.OgUrl, request.OgDescription)));

            return Ok(new InstagramCandidatePreviewResponse(result.Title, result.PreviewImageUrl));
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

    public sealed record InstagramCandidatePreviewRequest(
        string? SourceUrl,
        string? OgTitle,
        string? OgImage,
        string? OgUrl,
        string? OgDescription);

    public sealed record InstagramCandidatePreviewResponse(string? Title, string? PreviewImageUrl);

    public sealed record ResolveUrlMetadataResponse(string? Title, string? Source, string? PreviewImageUrl);
}
