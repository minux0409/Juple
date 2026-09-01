using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Items;
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
    IItemStateTransitionService itemStateTransitionService) : ControllerBase
{
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
}
