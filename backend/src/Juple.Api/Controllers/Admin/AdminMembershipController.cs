using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Api.Configuration;
using Juple.Application.Admin;
using Juple.Application.Billing;
using Juple.Domain.Admin;
using Juple.Domain.Billing;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.Api.Controllers.Admin;

[ApiController]
[Route("api/v1/admin/membership")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[EnableRateLimiting(RateLimitPolicies.AdminMembership)]
[AllowWhenSubscriptionExpired]
public sealed class AdminMembershipController(
    IAdminMembershipStore membership,
    IEntitlementStore entitlements,
    BillingOptions options,
    TimeProvider timeProvider) : ControllerBase
{
    private const int SearchLimit = 20;
    private const int MinimumFragmentLength = 4;

    [HttpGet("users")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> SearchAsync([FromQuery] string? jupleId, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(jupleId) || jupleId.Length > 32)
        {
            return BadRequest(new { code = "invalidMembershipLookup" });
        }

        var fragment = jupleId.Trim().Replace("-", "").Replace(" ", "").ToUpperInvariant();
        if (fragment.Length < MinimumFragmentLength || fragment.Length > UserPublicCode.Length
            || fragment.Any(character => !UserPublicCode.Alphabet.Contains(character)))
        {
            return BadRequest(new { code = "invalidMembershipLookup" });
        }

        var matches = await membership.SearchUsersAsync(fragment, SearchLimit + 1, cancellationToken);
        return Ok(new { users = matches.Take(SearchLimit), hasMore = matches.Count > SearchLimit });
    }

    [HttpGet("user")]
    [ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
    public async Task<IActionResult> FindAsync([FromQuery] long? userId, [FromQuery] string? jupleId, CancellationToken cancellationToken)
    {
        if ((userId is null) == (jupleId is null) || userId is <= 0)
        {
            return BadRequest(new { code = "invalidMembershipLookup" });
        }
        string? code = null;
        if (jupleId is not null && !UserPublicCode.TryNormalize(jupleId, out code))
        {
            return BadRequest(new { code = "invalidMembershipLookup" });
        }

        var target = await membership.FindUserAsync(userId, code, cancellationToken);
        if (target is null)
        {
            return NotFound();
        }

        var now = timeProvider.GetUtcNow();
        var rows = await membership.HistoryAsync(target.UserId, cancellationToken);
        var history = rows.Select(row => MembershipGrantHistory.From(row, now)).ToList();
        var configuredPreview = options.PurchasePreviewUserIds.Contains(target.UserId);
        var managedPreview = history.Any(row => row.Kind == "preview" && row.Status == "active");
        var store = StoreSubscriptionOwnership.From(await entitlements.GetOwnedPurchasesAsync(target.UserId, cancellationToken), now);
        var actor = AdminRequestContext.GetRequired(HttpContext);
        return Ok(new
        {
            user = target,
            programEnabled = options.ProgramEnabled,
            configuredPreview,
            managedPreview,
            membershipOffered = options.ProgramEnabled || configuredPreview || managedPreview,
            complimentaryEndsAtUtc = history.Where(row => row.Kind == "complimentary" && row.Status == "active").Max(row => row.EndsAtUtc),
            storeSubscription = CurrentUserBootstrapController.StoreSubscriptionResponse.From(store),
            canEdit = actor.Role == AdminRole.Owner && actor.UserId != target.UserId,
            canEditPreview = actor.Role == AdminRole.Owner,
            canEditComplimentary = actor.Role == AdminRole.Owner && actor.UserId != target.UserId,
            history,
        });
    }

    [HttpPut("users/{userId:long}/grants")]
    public async Task<IActionResult> GrantAsync(long userId, MembershipGrantRequest request, CancellationToken cancellationToken)
    {
        var actor = AdminRequestContext.GetRequired(HttpContext);
        if (actor.Role != AdminRole.Owner || (actor.UserId == userId && request.Kind == "complimentary"))
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }

        var now = timeProvider.GetUtcNow();
        var reason = request.Reason?.Trim();
        if (userId <= 0 || request.RequestId == Guid.Empty || !ValidReason(reason))
        {
            return BadRequest(new { code = "invalidMembershipGrant" });
        }

        MembershipGrant grant;
        switch (request.Kind)
        {
            case "preview" when request.StartsAtUtc is null && request.EndsAtUtc is null:
                grant = new(request.RequestId, userId, MembershipGrantKind.Preview, actor.UserId, now, now, null, reason!);
                break;
            case "complimentary" when request.StartsAtUtc is { } start && request.EndsAtUtc is { } end && start < end:
                grant = new(request.RequestId, userId, MembershipGrantKind.Complimentary, actor.UserId, now, start.ToUniversalTime(), end.ToUniversalTime(), reason!);
                break;
            default:
                return BadRequest(new { code = "invalidMembershipGrant" });
        }
        return WriteResult(await membership.GrantAsync(grant, cancellationToken));
    }

    [HttpPut("users/{userId:long}/grants/{grantId:guid}/revocation")]
    public async Task<IActionResult> RevokeAsync(long userId, Guid grantId, RevokeRequest request, CancellationToken cancellationToken)
    {
        var actor = AdminRequestContext.GetRequired(HttpContext);
        if (actor.Role != AdminRole.Owner)
        {
            return StatusCode(StatusCodes.Status403Forbidden);
        }
        var reason = request.Reason?.Trim();
        if (!ValidReason(reason))
        {
            return BadRequest(new { code = "invalidMembershipGrant" });
        }
        return WriteResult(await membership.RevokeAsync(actor.UserId, userId, grantId, timeProvider.GetUtcNow(), reason!, cancellationToken));
    }

    public sealed record RevokeRequest(string? Reason);

    private static bool ValidReason(string? reason) => reason is { Length: > 0 and <= 512 };

    private IActionResult WriteResult(MembershipWriteResult result) => result switch
    {
        MembershipWriteResult.Saved => Ok(new { saved = true }),
        MembershipWriteResult.Forbidden => StatusCode(StatusCodes.Status403Forbidden),
        MembershipWriteResult.Missing => NotFound(),
        _ => Conflict(new { code = "membershipGrantConflict" }),
    };
}
