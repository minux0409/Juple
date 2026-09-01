using Juple.Api.Authentication;
using Juple.Api.Items;
using Juple.Application.Categories;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Items.AssignItemCategory;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.GetItemDetail;
using Juple.Application.Items.GetItemsByState;
using Juple.Application.Items.ItemStateTransition;
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
    IItemStateTransitionService itemStateTransitionService,
    IGetItemsByStateService getItemsByStateService,
    IDeleteItemService deleteItemService,
    IUpdateItemDetailsService updateItemDetailsService,
    IGetItemDetailService getItemDetailService,
    IAssignItemCategoryService assignItemCategoryService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetByStateAsync(
        [FromQuery] string? state,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        [FromQuery] string? categoryId,
        CancellationToken cancellationToken)
    {
        if (!ItemsQueryParameters.TryParseState(state, out var itemState))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["state"] = ["state is required and must be 'wishlist' or 'archived'."],
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

        ItemPageCursor? typedCursor = null;
        if (cursor is not null && !ItemPageCursorCodec.TryDecode(cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        if (!ItemsQueryParameters.TryParseCategoryId(categoryId, out var typedCategoryId))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["categoryId"] = ["categoryId must be a positive integer."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await getItemsByStateService.GetAsync(
                currentUser.UserId, itemState, typedCategoryId, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new ItemsPageResponse(
                page.Items,
                page.NextCursor is { } nextCursor ? ItemPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CategoryNotFoundException)
        {
            return NotFound();
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
                ItemStateWireFormat.ToWireValue(details.State),
                details.StateChangedAtUtc,
                details.Category));
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

    [HttpPost("{id:long}/wishlist")]
    public Task<IActionResult> MoveToWishlistAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => itemStateTransitionService.MoveToWishlistAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpPost("{id:long}/archive")]
    public Task<IActionResult> MoveToArchiveAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => itemStateTransitionService.MoveToArchiveAsync(userId, id, cancellationToken),
            cancellationToken);

    [HttpDelete("{id:long}")]
    public Task<IActionResult> DeleteAsync(long id, CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => deleteItemService.DeleteAsync(userId, id, cancellationToken),
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

    [HttpPut("{id:long}/category")]
    public Task<IActionResult> AssignCategoryAsync(
        long id,
        AssignItemCategoryRequest request,
        CancellationToken cancellationToken) =>
        TransitionAsync(
            userId => assignItemCategoryService.AssignAsync(
                userId, id, request.CategoryId, cancellationToken),
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
        catch (CategoryNotFoundException)
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

    public sealed record ItemsPageResponse(IReadOnlyList<ItemListEntryDto> Items, string? NextCursor);

    public sealed record UpdateItemDetailsRequest(string? Title, string? Memo);

    public sealed record AssignItemCategoryRequest(long? CategoryId);

    public sealed record ItemDetailResponse(
        long Id,
        string Url,
        string? Title,
        string? Memo,
        DateTimeOffset SavedAtUtc,
        string State,
        DateTimeOffset StateChangedAtUtc,
        ItemCategoryDto? Category);
}
