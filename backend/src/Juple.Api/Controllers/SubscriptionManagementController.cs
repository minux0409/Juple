using Juple.Api.Authentication;
using Juple.Api.Safety;
using Juple.Application.Billing;
using Juple.Application.Billing.Apple;
using Juple.Application.Billing.GooglePlay;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Juple.Api.Configuration;

namespace Juple.Api.Controllers;

/// <summary>Existing purchase rights only. No catalog, new purchase handle, trial settlement or terms acceptance.</summary>
[ApiController]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Route("api/v1/billing/subscription-management")]
[AllowWithoutTermsAcceptance]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
[EnableRateLimiting(RateLimitPolicies.BillingGoogle)]
public sealed class SubscriptionManagementController(
    IExternalIdentityAccessor identity,
    ICurrentJupleUserAccessor users,
    IEntitlementService entitlements,
    IGoogleBillingService google,
    IAppleBillingService apple) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> Get(CancellationToken cancellationToken)
    {
        var owned = await entitlements.GetStoreSubscriptionForIdentityAsync(identity.GetRequired(), cancellationToken);
        var state = owned.State == Juple.Domain.Billing.StoreSubscriptionState.None && owned.EndState != Juple.Domain.Billing.StoreSubscriptionEnd.None
            ? owned.EndState.ToString()
            : owned.State == Juple.Domain.Billing.StoreSubscriptionState.Active && owned.AutoRenewing == false ? "Canceled" : owned.State.ToString();
        return Ok(new { state, source = owned.Source?.ToString(), owned.CurrentPeriodEndsAtUtc, owned.AutoRenewing });
    }

    /// <summary>Only this authenticated account's previously linked records are refreshed. No client tokens can claim a new purchase.</summary>
    [HttpPost("restore/{platform}")]
    public async Task<IActionResult> Restore(string platform, CancellationToken cancellationToken)
    {
        if (platform is not ("google" or "apple")) return BadRequest();
        try
        {
            var user = await users.GetRequiredAsync(identity.GetRequired(), cancellationToken);
            var outcome = platform == "google"
                ? (await google.RestoreAsync(user.UserId, [], cancellationToken)).Outcome.ToString()
                : (await apple.RestoreAsync(user.UserId, [], cancellationToken)).Outcome.ToString();
            return Ok(new { outcome });
        }
        catch (CurrentJupleUserNotFoundException) { return Conflict(new { code = "bootstrapRequired" }); }
        catch (BillingNotEnabledException) { return Conflict(new { code = "billingNotEnabled" }); }
    }
}
