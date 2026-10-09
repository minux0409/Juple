using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Join;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.Submissions;
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
    IPublicCollectionWriteService writeService,
    IPublicShareMembershipStore membershipStore,
    ICollectionJoinService joinService) : ControllerBase
{
    /// <summary>
    /// The signed-in caller asks the Owner to let them join - only through a PRIVATE link (공용 컬렉션 OFF); a public Collection is saved
    /// instead (POST save). 200 { outcome: requested | alreadyRequested | alreadyMember }
    /// (a request that is still waiting reveals nothing of the Collection); 404 unknown / revoked link; 403 collectionLocked until the
    /// link's password is proven (the password itself never makes a member); 409 joinNotAllowed for a public link.
    /// </summary>
    [HttpPost("join-requests")]
    [EnableRateLimiting(RateLimitPolicies.PublicCollectionWrite)]
    public Task<IActionResult> RequestToJoinAsync(
        string publicId,
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null) =>
        RunJoinAsync((userId) => joinService.RequestAsync(userId, publicId, unlockToken, cancellationToken), cancellationToken);

    /// <summary>
    /// 컬렉션 추가 (저장): the signed-in caller explicitly joins a PUBLIC Collection through its active link - always as a Viewer, no approval
    /// (the link's Read / Submit / Write permission never decides the role). 200 { outcome: joined | alreadyMember, collectionId, role };
    /// 404 unknown / revoked link; 403 collectionLocked until the link's password is proven (the password alone saves nothing);
    /// 409 joinNotAllowed for a private link (ask to join instead). Opening a link never calls this.
    /// </summary>
    [HttpPost("save")]
    [EnableRateLimiting(RateLimitPolicies.PublicCollectionWrite)]
    public Task<IActionResult> SavePublicCollectionAsync(
        string publicId,
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null) =>
        RunJoinAsync((userId) => joinService.SavePublicAsync(userId, publicId, unlockToken, cancellationToken), cancellationToken);

    private async Task<IActionResult> RunJoinAsync(Func<long, Task<CollectionJoinResultDto?>> action, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var result = await action(currentUser.UserId);
            return result is null ? NotFound() : Ok(result);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
        catch (CollectionCollaborationConflictException exception)
        {
            return CollectionProblems.Conflict(exception.Code);
        }
    }

    /// <summary>
    /// Is the signed-in caller already the Owner or a member of the Collection this link points to? Lets the app open a member
    /// straight into the normal Collection screen instead of the public viewer. The Collection id and role are returned ONLY to a
    /// member (never in the anonymous public DTO); a non-member gets just isMember:false. 404 for an unknown / revoked link.
    /// </summary>
    [HttpGet("membership")]
    public async Task<IActionResult> GetMyMembershipAsync(string publicId, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var membership = await membershipStore.GetAsync(publicId, currentUser.UserId, cancellationToken);
            return membership is null ? NotFound() : Ok(membership);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    /// <summary>
    /// The caller's OWN links still waiting for approval through this link (a signed-in non-member who
    /// proposed here), newest first with their total - never anyone else's, nothing about the
    /// Collection beyond that. Same unlock gate as reading the link (403 collectionLocked without it);
    /// 404 for an unknown / revoked link. Anonymous callers never get here (the controller requires a
    /// Juple user).
    /// </summary>
    [HttpGet("submissions/mine")]
    public async Task<IActionResult> ListMyProposalsAsync(
        string publicId,
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        CancellationToken cancellationToken,
        [FromHeader(Name = CollectionsController.UnlockTokenHeader)] string? unlockToken = null)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await writeService.ListMyProposalsAsync(
                currentUser.UserId, publicId, cursor, limit ?? PublicCollectionWriteService.MaxProposalPageSize, unlockToken, cancellationToken);
            return page is null ? NotFound() : Ok(page);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionLockedException)
        {
            return CollectionProblems.CollectionLocked();
        }
    }

    /// <summary>
    /// A signed-in user withdraws THEIR OWN still-waiting proposal (the same operation as the member route -
    /// it does not depend on this link still being active, so a revoked link never traps a pending request).
    /// 204; 404 (non-disclosing) for anything that is not the caller's own waiting proposal.
    /// </summary>
    [HttpDelete("submissions/mine/{submissionId:long}")]
    public async Task<IActionResult> CancelMyProposalAsync(
        string publicId,
        long submissionId,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await writeService.CancelMyProposalAsync(currentUser.UserId, publicId, submissionId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (CollectionLinkSubmissionNotFoundException)
        {
            return NotFound();
        }
    }

    /// <summary>
    /// 204 added (idempotent). 202 { submitted: true } when the link takes proposals (승인 후 추가) - it
    /// waits for the Owner; 409 linkAlreadyInCollection / linkAlreadyPending for a link already there
    /// or already waiting. 404 unknown/revoked link or an Item that is not the caller's.
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
            return await writeService.AddItemAsync(currentUser.UserId, publicId, itemId, unlockToken, cancellationToken) switch
            {
                null => NotFound(),
                CollectionLinkAddOutcome.Submitted => Accepted(new CollectionsController.LinkSubmittedResponse(true)),
                _ => NoContent(),
            };
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
        catch (CollectionCollaborationConflictException exception)
        {
            return CollectionProblems.Conflict(exception.Code);
        }
    }
}
