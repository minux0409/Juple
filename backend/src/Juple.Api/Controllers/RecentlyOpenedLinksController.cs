using Juple.Api.Authentication;
using Juple.Api.Items;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Items.DeleteAllRecentlyOpenedLinks;
using Juple.Application.Items.DeleteRecentlyOpenedLink;
using Juple.Application.Items.GetRecentlyOpenedLinks;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// My Page's "최근 본 링크" (Recently opened links) - a user opening their own saved Item's
/// original URL (see ItemsController's POST {id}/open, which records the event this list reads).
/// Never click-analytics: no OpenCount, no per-open event rows - see RecentlyOpenedItem.
/// </summary>
[ApiController]
[Route("api/v1/recently-opened-links")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class RecentlyOpenedLinksController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IGetRecentlyOpenedLinksService getRecentlyOpenedLinksService,
    IDeleteRecentlyOpenedLinkService deleteRecentlyOpenedLinkService,
    IDeleteAllRecentlyOpenedLinksService deleteAllRecentlyOpenedLinksService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAsync(
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!ItemsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {ItemsQueryParameters.MinLimit} and {ItemsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        RecentlyOpenedItemPageCursor? typedCursor = null;
        if (cursor is not null && !RecentlyOpenedItemPageCursorCodec.TryDecode(cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await getRecentlyOpenedLinksService.GetAsync(
                currentUser.UserId, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new RecentlyOpenedLinksPageResponse(
                page.Items,
                page.NextCursor is { } nextCursor ? RecentlyOpenedItemPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpDelete("{itemId:long}")]
    public async Task<IActionResult> DeleteAsync(long itemId, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await deleteRecentlyOpenedLinkService.DeleteAsync(currentUser.UserId, itemId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpDelete]
    public async Task<IActionResult> DeleteAllAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await deleteAllRecentlyOpenedLinksService.DeleteAllAsync(currentUser.UserId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    public sealed record RecentlyOpenedLinksPageResponse(
        IReadOnlyList<RecentlyOpenedItemEntryDto> Items,
        string? NextCursor);
}
