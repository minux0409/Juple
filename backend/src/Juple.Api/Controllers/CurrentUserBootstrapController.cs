using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Domain.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/users/me")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[AllowWhenSubscriptionExpired]
public sealed class CurrentUserBootstrapController : ControllerBase
{
    [HttpPost("bootstrap")]
    public async Task<IActionResult> BootstrapAsync(
        BootstrapCurrentUserRequest request,
        [FromServices] IExternalIdentityAccessor externalIdentityAccessor,
        [FromServices] ICurrentUserBootstrapService bootstrapService,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await bootstrapService.BootstrapAsync(
                externalIdentityAccessor.GetRequired(),
                new BootstrapCurrentUserCommand(request.PreferredLocale, request.TimeZoneId),
                cancellationToken);
            return Ok(new BootstrapCurrentUserResponse(result.Plan.ToString(), result.TimeZoneId, EntitlementResponse.From(result.Entitlement)));
        }
        catch (InvalidCurrentUserBootstrapRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record BootstrapCurrentUserRequest(string? PreferredLocale, string? TimeZoneId);

    /// <summary>Plan is "Free" or "Plus" (UserPlan.ToString(), matching how it's persisted - see UserConfiguration). Reuses this existing bootstrap call (already made on every app launch/sign-in) rather than adding a separate profile/entitlement endpoint.</summary>
    /// <param name="TimeZoneId">The user's stored IANA time zone - the one the server's date filters and calendar use; clients use it for the same "today" (additive field).</param>
    /// <param name="Plan">LEGACY compatibility only (old installed clients still read it) - never the entitlement source; see UserPlan.</param>
    /// <param name="Entitlement">The account's effective access (additive). Computed from server time; the app only presents it - the backend decides every write.</param>
    public sealed record BootstrapCurrentUserResponse(string Plan, string TimeZoneId, EntitlementResponse Entitlement);

    /// <summary>
    /// ProgramEnabled false = the subscription program is not launched: Status/Reason are null, CanWrite is true, nothing is restricted
    /// (this is NOT "active"). Otherwise Status is trial | active | gracePeriod | expired and Reason none | cancelled | billingIssue | refunded.
    /// AccessFrozenAtUtc is set only while expired. No store token, transaction id or identity hash is ever exposed.
    /// </summary>
    public sealed record EntitlementResponse(
        bool ProgramEnabled,
        string? Status,
        string? Reason,
        DateTimeOffset? TrialStartedAtUtc,
        DateTimeOffset? TrialEndsAtUtc,
        DateTimeOffset? CurrentPeriodEndsAtUtc,
        DateTimeOffset? AccessFrozenAtUtc,
        bool CanWrite,
        DateTimeOffset VerifiedAtUtc)
    {
        public static EntitlementResponse From(Entitlement entitlement) => new(
            entitlement.ProgramEnabled,
            entitlement.Status switch
            {
                EntitlementStatus.Trial => "trial",
                EntitlementStatus.Active => "active",
                EntitlementStatus.GracePeriod => "gracePeriod",
                EntitlementStatus.Expired => "expired",
                _ => null,
            },
            entitlement.Reason switch
            {
                EntitlementReason.None => "none",
                EntitlementReason.Cancelled => "cancelled",
                EntitlementReason.BillingIssue => "billingIssue",
                EntitlementReason.Refunded => "refunded",
                _ => null,
            },
            entitlement.TrialStartedAtUtc,
            entitlement.TrialEndsAtUtc,
            entitlement.CurrentPeriodEndsAtUtc,
            entitlement.AccessFrozenAtUtc,
            entitlement.CanWrite,
            entitlement.VerifiedAtUtc);
    }
}