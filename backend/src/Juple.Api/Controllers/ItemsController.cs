using System.Globalization;
using Juple.Api.Authentication;
using Juple.Api.Items;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.EmptyItemTrash;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemHistory;
using Juple.Application.Items.GetItemHistoryByDate;
using Juple.Application.Items.GetItemTrash;
using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Application.Items.PermanentlyDeleteItem;
using Juple.Application.Items.RecordItemOpen;
using Juple.Application.Items.RestoreItem;
using Juple.Application.Items.SetItemCoverImage;
using Juple.Application.Items.SetItemPreviewImage;
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
    ISetItemPreviewImageService setItemPreviewImageService,
    ISetItemCoverImageService setItemCoverImageService,
    IGetItemDetailService getItemDetailService,
    IGetItemHistoryService getItemHistoryService,
    IGetItemHistoryByDateService getItemHistoryByDateService,
    IRecordItemOpenService recordItemOpenService,
    IGetItemTrashService getItemTrashService,
    IRestoreItemService restoreItemService,
    IPermanentlyDeleteItemService permanentlyDeleteItemService,
    IApplyInstagramMetadataCandidateService applyInstagramMetadataCandidateService,
    IEmptyItemTrashService emptyItemTrashService) : ControllerBase
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

    /// <summary>
    /// The caller's most-recently-deleted Items (the trash) - size capped server-side to
    /// ItemTrashLimits.ListLimit (the same for every user), never by a client-supplied limit.
    /// </summary>
    [HttpGet("trash")]
    public async Task<IActionResult> GetTrashAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var items = await getItemTrashService.GetAsync(currentUser.UserId, cancellationToken);

            return Ok(new ItemTrashResponse(items));
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
                details.RepresentativeImage,
                details.PreviewImageUrl,
                details.CoverImage));
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

    /// <summary>Moves the Item to the trash (soft delete) - see DeleteItemService.</summary>
    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => deleteItemService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>Restores a trashed Item back to active. Not-currently-deleted (including never-deleted) is a 404, unlike DELETE's idempotent no-op.</summary>
    [HttpPost("{id:long}/restore")]
    public Task<IActionResult> RestoreAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => restoreItemService.RestoreAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>Hard-deletes a single trashed Item. An active (not yet soft-deleted) Item is rejected with a 404 - see PermanentlyDeleteItemService.</summary>
    [HttpDelete("{id:long}/permanent")]
    public Task<IActionResult> PermanentlyDeleteAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => permanentlyDeleteItemService.DeleteAsync(userId, id, cancellationToken),
            cancellationToken);

    /// <summary>Hard-deletes every one of the caller's trashed Items - the whole server-side trash, not just what the capped trash list shows.</summary>
    [HttpDelete("trash")]
    public async Task<IActionResult> EmptyTrashAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await emptyItemTrashService.EmptyAsync(currentUser.UserId, cancellationToken);

            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

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

    /// <summary>
    /// Sets the auto-extracted link-preview image (see UrlMetadataResult.PreviewImageUrl) - always
    /// a best-effort enrichment call from mobile, never part of Item creation/the title-memo update
    /// above, and never user-uploaded ItemImages (see ItemImagesController).
    /// </summary>
    [HttpPut("{id:long}/preview-image")]
    public Task<IActionResult> SetPreviewImageAsync(
        long id,
        SetItemPreviewImageRequest request,
        CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => setItemPreviewImageService.SetAsync(
                userId, id, new SetItemPreviewImageCommand(request.PreviewImageUrl), cancellationToken),
            cancellationToken);

    /// <summary>
    /// Device-fetched Instagram metadata fallback (see ApplyInstagramMetadataCandidateService): the
    /// caller's own device sends raw OpenGraph values it read from the Item's public Instagram page
    /// after the Backend's own fetch got Instagram's login redirect. Validated/normalized server-side
    /// and applied only to still-empty automatic fields; responds with the Item's resulting
    /// title/preview image so the client can show them without a separate refetch.
    /// </summary>
    [HttpPost("{id:long}/instagram-metadata-candidate")]
    public async Task<IActionResult> ApplyInstagramMetadataCandidateAsync(
        long id,
        InstagramMetadataCandidateRequest request,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await applyInstagramMetadataCandidateService.ApplyAsync(
                currentUser.UserId,
                id,
                new InstagramMetadataCandidateCommand(request.OgTitle, request.OgImage, request.OgUrl, request.OgDescription),
                cancellationToken);

            return Ok(new InstagramMetadataCandidateResponse(result.Title, result.PreviewImageUrl, result.Applied));
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
    }

    /// <summary>
    /// Sets (ImageId non-null) or clears (null) the user's explicit cover image choice - always
    /// one of this same Item's own uploaded ItemImages (see ItemImagesController), never the
    /// metadata PreviewImageUrl above. Immediate persistence, independent of the title/memo Save
    /// above - see SetItemCoverImageService's own remarks.
    /// </summary>
    [HttpPut("{id:long}/cover-image")]
    public Task<IActionResult> SetCoverImageAsync(
        long id,
        SetItemCoverImageRequest request,
        CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => setItemCoverImageService.SetAsync(
                userId, id, new SetItemCoverImageCommand(request.ImageId), cancellationToken),
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

    public sealed record ItemTrashResponse(IReadOnlyList<ItemTrashEntryDto> Items);

    public sealed record ItemHistoryByDateResponse(
        DateOnly Date,
        IReadOnlyList<ItemHistoryEntryDto> Items,
        string? NextCursor);

    public sealed record UpdateItemDetailsRequest(string? Title, string? Memo);

    public sealed record SetItemPreviewImageRequest(string? PreviewImageUrl);

    public sealed record SetItemCoverImageRequest(long? ImageId);

    public sealed record InstagramMetadataCandidateRequest(
        string? OgTitle,
        string? OgImage,
        string? OgUrl,
        string? OgDescription);

    public sealed record InstagramMetadataCandidateResponse(string? Title, string? PreviewImageUrl, bool Applied);

    public sealed record ItemDetailResponse(
        long Id,
        string Url,
        string? Title,
        string? Memo,
        DateTimeOffset SavedAtUtc,
        RepresentativeImageDto? RepresentativeImage,
        string? PreviewImageUrl,
        RepresentativeImageDto? CoverImage);
}
