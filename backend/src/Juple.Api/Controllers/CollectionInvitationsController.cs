using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// The person-to-person side of Collection collaboration: your own Juple ID, exact Juple ID
/// lookup, and the invitations addressed to you. Invitations are acted on by id, but only the user
/// they are addressed to can see or answer them - anyone else gets a plain 404, so an id (or any
/// link carrying it) is worthless to someone else.
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.RequireWriteAccess]
public sealed class CollectionInvitationsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICollectionCollaborationService collaborationService) : ControllerBase
{
    [HttpGet("users/me/juple-id")]
    public Task<IActionResult> GetMyJupleIdAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.GetMyJupleIdAsync(userId, cancellationToken),
            jupleId => Ok(new JupleIdResponse(jupleId)),
            cancellationToken);

    /// <summary>
    /// Exact match only (no partial search, no listing); rate limited per signed-in user. The
    /// response is the Juple ID itself - never an email or internal id.
    /// </summary>
    [Juple.Api.Billing.AllowWhenSubscriptionExpired]
    [HttpPost("users/lookup-by-juple-id")]
    [EnableRateLimiting(RateLimitPolicies.JupleIdLookup)]
    public Task<IActionResult> LookupAsync(LookupByJupleIdRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.LookupAsync(userId, request.JupleId, cancellationToken),
            result => Ok(result),
            cancellationToken);

    [HttpGet("users/me/collection-invitations")]
    public Task<IActionResult> ListReceivedAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => collaborationService.ListReceivedInvitationsAsync(userId, cancellationToken),
            invitations => Ok(new ReceivedInvitationsResponse(invitations)),
            cancellationToken);

    [Juple.Api.Billing.CollectionOwnedWrite(InvitationIdRoute = "invitationId")]

    [HttpPost("collection-invitations/{invitationId:long}/accept")]
    public Task<IActionResult> AcceptAsync(long invitationId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await collaborationService.AcceptInvitationAsync(userId, invitationId, cancellationToken);
                return true;
            },
            _ => NoContent(),
            cancellationToken);

    [Juple.Api.Billing.AllowWhenSubscriptionExpired]

    [HttpPost("collection-invitations/{invitationId:long}/decline")]
    public Task<IActionResult> DeclineAsync(long invitationId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await collaborationService.DeclineInvitationAsync(userId, invitationId, cancellationToken);
                return true;
            },
            _ => NoContent(),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync<TResult>(
        Func<long, Task<TResult>> action,
        Func<TResult, IActionResult> success,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return success(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (JupleIdNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionInvitationNotFoundException)
        {
            return NotFound();
        }
        catch (CollectionCollaborationConflictException exception)
        {
            return CollectionProblems.Conflict(exception.Code);
        }
    }

    public sealed record JupleIdResponse(string JupleId);

    public sealed record LookupByJupleIdRequest(string? JupleId);

    public sealed record ReceivedInvitationsResponse(IReadOnlyList<ReceivedCollectionInvitationDto> Items);
}
