using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Api.Public;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The anonymous Public Web Viewer's only backend surface - no [Authorize], no auth token
/// accepted or required anywhere here. Deliberately a separate controller from CollectionsController
/// (not an [AllowAnonymous] action on it) so the anonymous route tree stays trivially auditable:
/// nothing under api/v1/public/* ever touches ICurrentJupleUserAccessor or any per-user store.
/// CORS is scoped to this controller alone (see Program.cs's "PublicWeb" policy) - the
/// authenticated Mobile-facing API surface's CORS posture is unchanged by this feature.
/// </summary>
[ApiController]
[Route("api/v1/public/collections")]
[EnableCors(CorsPolicies.PublicWeb)]
public sealed class PublicCollectionsController(
    IPublicCollectionService publicCollectionService,
    IPublicCollectionItemPageCursorCodec cursorCodec) : ControllerBase
{
    /// <summary>publicId unknown or its share revoked - both collapse to the same 404, never distinguishable by the caller.</summary>
    [HttpGet("{publicId}")]
    public async Task<IActionResult> GetAsync(string publicId, CancellationToken cancellationToken)
    {
        var collection = await publicCollectionService.GetCollectionAsync(publicId, cancellationToken);
        return collection is null ? NotFound() : Ok(collection);
    }

    /// <summary>
    /// Cursor-paginated exactly like GET /api/v1/collections/{id}/items - a shared Collection's
    /// Item list is unbounded here too, just with its own PublicCollectionItemPageCursorCodec.
    /// </summary>
    [HttpGet("{publicId}/items")]
    public async Task<IActionResult> GetItemsAsync(
        string publicId,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!CollectionsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {CollectionsQueryParameters.MinLimit} and {CollectionsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        CollectionItemPageCursor? typedCursor = null;
        if (cursor is not null && !cursorCodec.TryDecode(publicId, cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        var page = await publicCollectionService.GetItemsAsync(publicId, typedCursor, resolvedLimit, cancellationToken);
        if (page is null)
        {
            return NotFound();
        }

        return Ok(new PublicCollectionItemsPageResponse(
            page.Items,
            page.NextCursor is { } nextCursor ? cursorCodec.Encode(publicId, nextCursor) : null));
    }

    public sealed record PublicCollectionItemsPageResponse(
        IReadOnlyList<PublicCollectionItemDto> Items,
        string? NextCursor);
}
