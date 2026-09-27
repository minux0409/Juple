using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// Adding a link through a writable public link ("모든 사용자: 작성"). Deliberately NOT under the
/// anonymous api/v1/public/* tree (PublicCollectionsController stays free of any per-user code):
/// this controller requires a signed-in Juple user, so an anonymous call is a plain 401 - public
/// write is never anonymous. The caller adds one of their OWN Items (saved first through the normal
/// inbox save, with its URL checks); the adder is recorded, and nothing else is granted - no
/// membership, no editing/removing/reordering, no management.
/// </summary>
[ApiController]
[Route("api/v1/public-shares/{publicId}")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class PublicShareWriteController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IPublicCollectionWriteService writeService) : ControllerBase
{
    /// <summary>
    /// 204 added (idempotent). 404 unknown/revoked link or an Item that is not the caller's.
    /// 403 publicShareReadOnly for a read-only link; 403 collectionLocked for a locked Collection
    /// without the link's unlock grant (X-Juple-Collection-Unlock).
    /// </summary>
    [HttpPut("items/{itemId:long}")]
    [EnableRateLimiting(RateLimitPolicies.PublicCollectionWrite)]
    public async Task<IActionResult> AddItemAsync(
        string publicId,
        long itemId,
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return await writeService.AddItemAsync(currentUser.UserId, publicId, itemId, unlockToken, cancellationToken)
                ? NoContent()
                : NotFound();
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
        catch (PublicShareReadOnlyException)
        {
            return CollectionProblems.Create(
                StatusCodes.Status403Forbidden, "This link is read-only.", CollectionProblems.PublicShareReadOnly);
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
    }
}
