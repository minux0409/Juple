using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Api.Configuration;
using Juple.Domain.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

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
        [FromServices] IOptions<MobileVersionPolicyOptions> versionPolicy,
        CancellationToken cancellationToken)
    {
        try
        {
            var result = await bootstrapService.BootstrapAsync(
                externalIdentityAccessor.GetRequired(),
                new BootstrapCurrentUserCommand(request.PreferredLocale, request.TimeZoneId),
                cancellationToken);
            return Ok(new BootstrapCurrentUserResponse(result.Plan.ToString(), result.TimeZoneId, EntitlementResponse.From(result.Entitlement), MobileVersionPolicyResponse.From(versionPolicy.Value), StoreSubscriptionResponse.From(result.StoreSubscription)));
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
    public sealed record BootstrapCurrentUserResponse(
        string Plan,
        string TimeZoneId,
        EntitlementResponse Entitlement,
        MobileVersionPolicyResponse MobileVersionPolicy,
        StoreSubscriptionResponse StoreSubscription);

    /// <summary>
    /// Whether the account owns a verified store subscription (additive; an older client ignores it) - NOT the same as Entitlement: with the
    /// program off, Entitlement.Status is null ("not required") while this can still be "active". State is none | active | gracePeriod.
    /// Platform is "google" while owned. CurrentPeriodEndsAtUtc is when the paid period ends; AutoRenewing false means it was cancelled and
    /// will not renew. No purchase token, order id, internal id or raw store response is ever exposed.
    /// </summary>
    public sealed record StoreSubscriptionResponse(string State, string? Platform, string? ProductId, DateTimeOffset? CurrentPeriodEndsAtUtc, bool? AutoRenewing)
    {
        public static StoreSubscriptionResponse From(StoreSubscriptionOwnership? ownership) => ownership is null || ownership.State == StoreSubscriptionState.None
            ? new("none", null, null, null, null)
            : new(
                ownership.State == StoreSubscriptionState.GracePeriod ? "gracePeriod" : "active",
                ownership.Source switch { StoreSource.GooglePlay => "google", _ => null },
                ownership.ProductId,
                ownership.CurrentPeriodEndsAtUtc,
                ownership.AutoRenewing);
    }

    /// <summary>
    /// Which installed builds are current / still supported, per platform (additive; an older client ignores it). Build numbers are
    /// authoritative. A platform with LatestBuild 0 has no policy. StoreUrl is null when not configured.
    /// </summary>
    public sealed record MobileVersionPolicyResponse(MobilePlatformVersionPolicyResponse Android, MobilePlatformVersionPolicyResponse Ios)
    {
        public static MobileVersionPolicyResponse From(MobileVersionPolicyOptions options) => new(
            MobilePlatformVersionPolicyResponse.From(options.Android),
            MobilePlatformVersionPolicyResponse.From(options.Ios));
    }

    public sealed record MobilePlatformVersionPolicyResponse(int LatestBuild, int MinimumSupportedBuild, string? StoreUrl)
    {
        public static MobilePlatformVersionPolicyResponse From(MobilePlatformVersionPolicy policy) => new(
            policy.LatestBuild,
            policy.MinimumSupportedBuild,
            string.IsNullOrWhiteSpace(policy.StoreUrl) ? null : policy.StoreUrl.Trim());
    }

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
                EntitlementReason.Paused => "paused",
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