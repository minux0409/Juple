using Juple.Api.Authentication;
using Juple.Application.Collections.HomeSummary;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// What Home needs about the caller's Collections in ONE read: the exact number of Collections in the All / Favorites /
/// Shared scopes and the first favorite Collections as shortcuts. It replaces three full lists (scope all / favorites /
/// shared, limit 50) that Home used only for three numbers and six tiles. Same definitions and the same per-user result as
/// <c>GET /api/v1/collections?scope=…</c>; the owner is always the caller (never a parameter). Read-only.
/// </summary>
[ApiController]
[Route("api/v1/home/summary")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class HomeSummaryController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IHomeCollectionsSummaryService summaryService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> GetAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return Ok(await summaryService.GetAsync(currentUser.UserId, cancellationToken));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }
}
