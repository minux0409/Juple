using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Api.Public;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Microsoft.AspNetCore.Cors;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

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
    /// <remarks>A locked share without a valid grant answers { name: null, isLocked: true } - nothing else.</remarks>
    [HttpGet("{publicId}")]
    public async Task<IActionResult> GetAsync(
        string publicId,
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null)
    {
        var collection = await publicCollectionService.GetCollectionAsync(publicId, unlockToken, cancellationToken);
        return collection is null ? NotFound() : Ok(collection);
    }

    /// <summary>
    /// Verifies a locked share's password (throttled per share link, persisted across replicas)
    /// and returns a short-lived grant bound to this share link only. Called server-side by the
    /// Public Web (never from the browser), which keeps the grant in an HttpOnly cookie. The
    /// response never distinguishes "wrong password" beyond a generic code.
    /// </summary>
    [HttpPost("{publicId}/unlock")]
    [EnableRateLimiting(RateLimitPolicies.PublicCollectionUnlock)]
    public async Task<IActionResult> UnlockAsync(
        string publicId,
        UnlockPublicCollectionRequest request,
        CancellationToken cancellationToken,
        [FromHeader(Name = UnlockAttemptHeader)] string? clientAttemptId = null)
    {
        try
        {
            var grant = await publicCollectionService.UnlockAsync(publicId, request.Password, clientAttemptId, cancellationToken);
            return grant is null
                ? NotFound()
                : Ok(new UnlockPublicCollectionResponse(grant.Token, grant.ExpiresAtUtc));
        }
        catch (InvalidCollectionPasswordException)
        {
            return CollectionProblems.InvalidCollectionPassword();
        }
        catch (CollectionNotLockedException)
        {
            return CollectionProblems.CollectionNotLocked();
        }
        catch (CollectionUnlockThrottledException exception)
        {
            return CollectionProblems.TooManyUnlockAttempts(Response, exception.RetryAfterUtc, TimeProvider.System.GetUtcNow());
        }
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
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null)
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

        PublicCollectionItemPage? page;
        try
        {
            page = await publicCollectionService.GetItemsAsync(publicId, typedCursor, resolvedLimit, unlockToken, cancellationToken);
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }

        if (page is null)
        {
            return NotFound();
        }

        return Ok(new PublicCollectionItemsPageResponse(
            page.Items,
            page.NextCursor is { } nextCursor ? cursorCodec.Encode(publicId, nextCursor) : null));
    }

    /// <summary>
    /// Opaque per-browser attempt id the Public Web sends (from its own HttpOnly cookie) - scopes the
    /// failed-attempt counter only (see CollectionUnlockBuckets); never an identity or a permission.
    /// </summary>
    public const string UnlockAttemptHeader = "X-Juple-Unlock-Attempt";

    public sealed record UnlockPublicCollectionRequest(string? Password);

    public sealed record UnlockPublicCollectionResponse(string UnlockToken, DateTimeOffset ExpiresAtUtc);

    public sealed record PublicCollectionItemsPageResponse(
        IReadOnlyList<PublicCollectionItemDto> Items,
        string? NextCursor);
}
