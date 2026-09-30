using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections;
using Juple.Application.Collections.AddItemToCollections;
using Juple.Application.Identity;
using Juple.Application.Items;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// 다른 컬렉션에 복제 - see AddItemToCollectionsService. Puts one of the caller's Items into several of
/// their own Collections in one call; the single-Collection PUT /api/v1/collections/{id}/items/{itemId}
/// is unchanged. Unlock grants travel per destination in the body (unlockTokens: collectionId → grant),
/// since each locked Collection has its own and one header could carry only a few.
/// </summary>
[ApiController]
[Route("api/v1/items/{itemId:long}/collections")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class ItemCollectionsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IAddItemToCollectionsService addItemToCollectionsService) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> AddAsync(long itemId, AddItemToCollectionsRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await addItemToCollectionsService.AddAsync(
                currentUser.UserId,
                itemId,
                request.CollectionIds,
                request.UnlockTokens,
                cancellationToken);
            return Ok(new AddItemToCollectionsResponse(result.Added, result.Skipped));
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
        catch (ItemNotFoundException)
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
    }

    public sealed record AddItemToCollectionsRequest(IReadOnlyList<long>? CollectionIds, IReadOnlyDictionary<long, string>? UnlockTokens);

    /// <summary>addedCount + skippedCount (already there) = distinct collectionIds sent.</summary>
    public sealed record AddItemToCollectionsResponse(int AddedCount, int SkippedCount);
}
