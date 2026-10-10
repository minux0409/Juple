using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.CopyItems;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// 내 컬렉션으로 복사 - see CopyCollectionItemsService. {id} is the SOURCE (a Collection shared with the
/// caller); the destination (one of the caller's own) is in the body. Unlock grants for either
/// side travel together in the usual X-Juple-Collection-Unlock header, comma-separated.
/// </summary>
[ApiController]
[Route("api/v1/collections/{id:long}/items/copy")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.RequireWriteAccess]
[Juple.Api.Billing.CollectionOwnedWrite(RouteIds = new[] { "id" }, RequestProperties = new[] { "DestinationCollectionId" })]
public sealed class CollectionItemCopyController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICopyCollectionItemsService copyService) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> CopyAsync(long id, CopyCollectionItemsRequest request, CancellationToken cancellationToken)
    {
        if (request.DestinationCollectionId is not { } destinationCollectionId)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["destinationCollectionId"] = ["destinationCollectionId is required."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await copyService.CopyAsync(
                currentUser.UserId,
                id,
                request.ItemIds,
                destinationCollectionId,
                Request.Headers[CollectionsController.UnlockTokenHeader].ToString(),
                cancellationToken);
            return Ok(new CopyCollectionItemsResponse(result.Copied, result.AlreadyInDestination, result.Unavailable));
        }
        catch (InvalidCollectionException exception)
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
        catch (CollectionNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionForbiddenException)
        {
            return CollectionProblems.CollectionForbidden();
        }
        catch (CollectionSharePasswordRequiredException)
        {
            return CollectionProblems.SharePasswordRequired();
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
        catch (CollectionConcurrencyException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "The Collection was modified concurrently.");
        }
    }

    public sealed record CopyCollectionItemsRequest(long? DestinationCollectionId, IReadOnlyList<long>? ItemIds);

    /// <summary>copiedCount + skippedCount (already in the destination) + unavailableCount (gone from the source) = distinct ids sent.</summary>
    public sealed record CopyCollectionItemsResponse(int CopiedCount, int SkippedCount, int UnavailableCount);
}
