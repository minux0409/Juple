using System.Globalization;
using Juple.Api.Authentication;
using Juple.Api.Items;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.RecordItemOpen;
using Juple.Application.Items.UpdateItemDetails;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/items")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class ItemsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IDeleteItemService deleteItemService,
    IUpdateItemDetailsService updateItemDetailsService,
    IGetItemDetailService getItemDetailService,
    IGetItemHistoryService getItemHistoryService,
    IGetItemHistoryByDateService getItemHistoryByDateService,
    IRecordItemOpenService recordItemOpenService) : ControllerBase
{
    /// <summary>
    /// All Items the user has ever saved, newest-saved-first. See docs/product-overview.md
    /// "History".
    /// </summary>
    [HttpGet("history")]
    public async Task<IActionResult> GetHistoryAsync(
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

        ItemHistoryPageCursor? typedCursor = null;
        if (cursor is not null && !ItemHistoryPageCursorCodec.TryDecode(cursor, out typedCursor))
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
            var page = await getItemHistoryService.GetAsync(
                currentUser.UserId, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new ItemHistoryPageResponse(
                page.Items,
                page.NextCursor is { } nextCursor ? ItemHistoryPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    /// <summary>
    /// Items the user saved (SavedAtUtc) on a single local calendar date - powers Home
    /// ("오늘 저장한 링크"). date is required because Home always asks for a specific day; the
    /// local-date-to-UTC-range conversion uses DailyInboxDateRangeCalculator + currentUser.TimeZoneId.
    /// Cursor-paginated with the same limit/cursor conventions and ItemHistoryPageCursorCodec as
    /// GET /api/v1/items/history - a day's worth of Items is unbounded, so this never returns a
    /// whole day in one response.
    /// </summary>
    [HttpGet("history/date")]
    public async Task<IActionResult> GetHistoryByDateAsync(
        [FromQuery] string? date,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!TryParseDate(date, out var parsedDate))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["date"] = ["date is required and must use the YYYY-MM-DD format."],
            }));
        }

        if (!ItemsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {ItemsQueryParameters.MinLimit} and {ItemsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        ItemHistoryPageCursor? typedCursor = null;
        if (cursor is not null && !ItemHistoryPageCursorCodec.TryDecode(cursor, out typedCursor))
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
            var result = await getItemHistoryByDateService.GetAsync(
                currentUser.UserId, currentUser.TimeZoneId, parsedDate, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new ItemHistoryByDateResponse(
                result.Date,
                result.Items,
                result.NextCursor is { } nextCursor ? ItemHistoryPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpGet("{id:long}")]
    public async Task<IActionResult> GetDetailAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var details = await getItemDetailService.GetAsync(currentUser.UserId, id, cancellationToken);

            return Ok(new ItemDetailResponse(
                details.Id,
                details.Url,
                details.Title,
                details.Memo,
                details.SavedAtUtc,
                details.RepresentativeImage));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
    }

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => deleteItemService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>
    /// Records that the user opened this Item's original URL (My Page → "최근 본 링크" /
    /// Recently opened links - see RecentlyOpenedLinksController). Mobile calls this only after
    /// Linking.openURL actually succeeds, and only best-effort - a failure here must never be
    /// surfaced as a failure to open the URL itself.
    /// </summary>
    [HttpPost("{id:long}/open")]
    public Task<IActionResult> RecordOpenAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => recordItemOpenService.RecordAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpPut("{id:long}/details")]
    public Task<IActionResult> UpdateDetailsAsync(
        long id,
        UpdateItemDetailsRequest request,
        CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => updateItemDetailsService.UpdateAsync(
                userId, id, new UpdateItemDetailsCommand(request.Title, request.Memo), cancellationToken),
            cancellationToken);

    private async Task<IActionResult> TransitionAsync(
        Func<long, Task> transition,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await transition(currentUser.UserId);
            return NoContent();
        }
        catch (InvalidItemDetailsException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (ItemNotFoundException)
        {
            return NotFound();
        }
        catch (ItemConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Item was modified concurrently.");
        }
    }

    /// <summary>date is required here - Home always asks for one specific local date.</summary>
    private static bool TryParseDate(string? value, out DateOnly date)
    {
        if (value is not null && DateOnly.TryParseExact(
            value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsedDate))
        {
            date = parsedDate;
            return true;
        }

        date = default;
        return false;
    }

    public sealed record ItemHistoryPageResponse(IReadOnlyList<ItemHistoryEntryDto> Items, string? NextCursor);

    public sealed record ItemHistoryByDateResponse(
        DateOnly Date,
        IReadOnlyList<ItemHistoryEntryDto> Items,
        string? NextCursor);

    public sealed record UpdateItemDetailsRequest(string? Title, string? Memo);

    public sealed record ItemDetailResponse(
        long Id,
        string Url,
        string? Title,
        string? Memo,
        DateTimeOffset SavedAtUtc,
        RepresentativeImageDto? RepresentativeImage);
}
