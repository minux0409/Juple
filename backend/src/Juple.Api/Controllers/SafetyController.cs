using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Safety;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers;

/// <summary>
/// Safety: accepting the Terms of Service, reporting content or a person, and blocking / unblocking a person. Every one of these always
/// works - also for an account whose subscription expired, and (for reporting and blocking) before the Terms were accepted. The acting
/// person is always the internal user taken from the authenticated principal; a request never carries a user id. There is deliberately NO
/// route to read or change reports: Juple has no operator authorization yet (see docs/ugc-moderation.md).
/// </summary>
[ApiController]
[Route("api/v1")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
public sealed class SafetyController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ITermsConsentService termsService,
    IReportService reportService,
    IUserBlockService blockService) : ControllerBase
{
    [HttpGet("users/me/terms")]
    public Task<IActionResult> GetTermsAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => termsService.GetStatusAsync(userId, cancellationToken), status => Ok(TermsResponse.From(status)), cancellationToken);

    /// <summary>Records the agreement to the CURRENT version. The version is sent so an old screen can never agree to a newer text.</summary>
    [HttpPost("users/me/terms-acceptance")]
    public Task<IActionResult> AcceptTermsAsync([FromBody] AcceptTermsRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(userId => termsService.AcceptAsync(userId, request.Version, cancellationToken), status => Ok(TermsResponse.From(status)), cancellationToken);

    /// <summary>201 for a new report, 200 when this person already has an open report of the same thing (nothing is created twice).</summary>
    [HttpPost("reports")]
    [EnableRateLimiting(RateLimitPolicies.ReportCreate)]
    public Task<IActionResult> CreateReportAsync([FromBody] CreateReportRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => reportService.CreateAsync(userId, new CreateReportCommand(request.TargetType, request.TargetId, request.CollectionId, request.Reason, request.Details), cancellationToken),
            receipt => receipt.AlreadyReported ? Ok(receipt) : StatusCode(StatusCodes.Status201Created, receipt),
            cancellationToken);

    [HttpPost("users/{jupleId}/block")]
    [EnableRateLimiting(RateLimitPolicies.BlockChange)]
    public Task<IActionResult> BlockAsync(string jupleId, CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => { await blockService.BlockAsync(userId, jupleId, cancellationToken); return true; }, _ => NoContent(), cancellationToken);

    [HttpDelete("users/{jupleId}/block")]
    [EnableRateLimiting(RateLimitPolicies.BlockChange)]
    public Task<IActionResult> UnblockAsync(string jupleId, CancellationToken cancellationToken) =>
        ExecuteAsync(async userId => { await blockService.UnblockAsync(userId, jupleId, cancellationToken); return true; }, _ => NoContent(), cancellationToken);

    [HttpGet("users/me/blocked-users")]
    public Task<IActionResult> ListBlockedAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => blockService.ListAsync(userId, cancellationToken), items => Ok(new BlockedUsersResponse(items)), cancellationToken);

    private async Task<IActionResult> ExecuteAsync<TResult>(Func<long, Task<TResult>> action, Func<TResult, IActionResult> success, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
            return success(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(statusCode: StatusCodes.Status409Conflict, title: "Juple user bootstrap is required.");
        }
        catch (InvalidTermsVersionException)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]> { ["version"] = ["version is not the current Terms version."] }));
        }
        catch (InvalidReportException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]> { [exception.Field] = [exception.Message] }));
        }
        catch (ReportOwnContentException)
        {
            return SafetyProblems.Create(StatusCodes.Status400BadRequest, "You cannot report your own content.", "cannotReportOwnContent");
        }
        catch (ReportTargetNotFoundException)
        {
            return NotFound();
        }
        catch (JupleIdNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidBlockException exception)
        {
            return SafetyProblems.Create(StatusCodes.Status400BadRequest, exception.Message, "cannotBlockSelf");
        }
    }

    public sealed record AcceptTermsRequest(string? Version);

    public sealed record TermsResponse(string CurrentVersion, string? AcceptedVersion, DateTimeOffset? AcceptedAtUtc, bool IsAccepted)
    {
        public static TermsResponse From(TermsStatusDto status) => new(status.CurrentVersion, status.AcceptedVersion, status.AcceptedAtUtc, status.IsAccepted);
    }

    /// <summary>TargetType: User | Collection | Item | Comment. TargetId: the Juple ID of a user, otherwise the numeric id. CollectionId is required for an Item (the Collection it is seen through).</summary>
    public sealed record CreateReportRequest(string? TargetType, string? TargetId, long? CollectionId, string? Reason, string? Details);

    public sealed record BlockedUsersResponse(IReadOnlyList<BlockedUserDto> Items);
}
