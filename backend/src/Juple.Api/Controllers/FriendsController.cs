using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Friends;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// Friends: a personal address book of other Juple users, built only from exact Juple IDs and
/// mutual consent (request → accept). A friendship grants no access to anything - Collections are
/// still shared only through their own invitation/accept flow. Every id is answered only for the
/// people involved; anyone else gets a plain 404. Responses carry Juple IDs, display names and the
/// caller's own private notes - never internal ids, emails or identity-provider ids.
/// </summary>
[ApiController]
[Route("api/v1/friends")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class FriendsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IFriendService friendService) : ControllerBase
{
    private const int DefaultLimit = 50;
    private const int MaxLimit = 100;

    /// <summary>Accepted friends, newest first; query searches only within them (name, Juple ID, my note).</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync(
        [FromQuery] string? query,
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => friendService.ListFriendsAsync(userId, query, cursor, Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit), cancellationToken),
            page => Ok(new FriendsResponse(page.Items, page.NextCursor?.ToString())),
            cancellationToken);

    [HttpGet("requests")]
    public Task<IActionResult> ListRequestsAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => friendService.ListRequestsAsync(userId, cancellationToken),
            requests => Ok(new FriendRequestsResponse(requests)),
            cancellationToken);

    /// <summary>Exact Juple ID only; shares the Juple ID lookup rate limit (per signed-in user).</summary>
    [HttpPost("requests")]
    [EnableRateLimiting(RateLimitPolicies.JupleIdLookup)]
    public Task<IActionResult> SendRequestAsync(SendFriendRequestRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => friendService.SendRequestAsync(userId, request.JupleId, cancellationToken),
            created => Ok(created),
            cancellationToken);

    [HttpPost("requests/{requestId:long}/accept")]
    public Task<IActionResult> AcceptAsync(long requestId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => friendService.AcceptAsync(userId, requestId, cancellationToken),
            friend => Ok(friend),
            cancellationToken);

    [HttpPost("requests/{requestId:long}/decline")]
    public Task<IActionResult> DeclineAsync(long requestId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await friendService.DeclineAsync(userId, requestId, cancellationToken);
                return true;
            },
            _ => NoContent(),
            cancellationToken);

    /// <summary>The requester withdraws their own pending request.</summary>
    [HttpDelete("requests/{requestId:long}")]
    public Task<IActionResult> CancelAsync(long requestId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await friendService.CancelAsync(userId, requestId, cancellationToken);
                return true;
            },
            _ => NoContent(),
            cancellationToken);

    /// <summary>Removes the friendship (and both private notes). Shared Collections are not affected.</summary>
    [HttpDelete("{friendshipId:long}")]
    public Task<IActionResult> RemoveAsync(long friendshipId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            async userId =>
            {
                await friendService.RemoveFriendAsync(userId, friendshipId, cancellationToken);
                return true;
            },
            _ => NoContent(),
            cancellationToken);

    /// <summary>Sets the caller's own private note about this friend (empty clears it).</summary>
    [HttpPut("{friendshipId:long}/note")]
    public Task<IActionResult> SetNoteAsync(long friendshipId, SetFriendNoteRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => friendService.SetNoteAsync(userId, friendshipId, request.Note, cancellationToken),
            friend => Ok(friend),
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
        catch (FriendNotFoundException exception)
        {
            return exception.Code is null
                ? NotFound()
                : CollectionProblems.Create(StatusCodes.Status404NotFound, "The friend request is no longer pending.", exception.Code);
        }
        catch (FriendRequestConflictException exception)
        {
            return CollectionProblems.Create(StatusCodes.Status409Conflict, "The friend request conflicts with an existing one.", exception.Code);
        }
        catch (InvalidFriendRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record FriendsResponse(IReadOnlyList<FriendDto> Items, string? NextCursor);

    public sealed record FriendRequestsResponse(IReadOnlyList<FriendRequestDto> Items);

    public sealed record SendFriendRequestRequest(string? JupleId);

    public sealed record SetFriendNoteRequest(string? Note);
}
