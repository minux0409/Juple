using Juple.Api.Authentication;
using Juple.Api.Items;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Items.DeleteItem;
using Juple.Application.Items.GetItemsByState;
using Juple.Application.Items.ItemStateTransition;
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
    IDeleteItemService deleteItemService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetByStateAsync(
        [FromQuery] string? state,
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
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

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await getItemsByStateService.GetAsync(
                currentUser.UserId, itemState, typedCursor, resolvedLimit, cancellationToken);

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

    public sealed record ItemsPageResponse(IReadOnlyList<ItemListEntryDto> Items, string? NextCursor);
}
