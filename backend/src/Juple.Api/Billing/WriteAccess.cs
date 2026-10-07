using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Juple.Api.Billing;

/// <summary>
/// The 403 an Expired account gets for a content write: ProblemDetails with the stable machine-readable
/// <c>code = "subscriptionRequired"</c> (403 like every other "you may not do this" outcome in this API - lock, role,
/// password - rather than a one-off 402). No entitlement detail, token or id is ever included.
/// </summary>
public static class BillingProblems
{
    public const string SubscriptionRequiredCode = "subscriptionRequired";

    public static ObjectResult SubscriptionRequired()
    {
        var problem = new ProblemDetails { Status = StatusCodes.Status403Forbidden, Title = "A subscription is required to change content." };
        problem.Extensions["code"] = SubscriptionRequiredCode;
        return new ObjectResult(problem) { StatusCode = StatusCodes.Status403Forbidden };
    }
}

/// <summary>
/// Marks an endpoint (or a whole controller) that stays usable when the account is Expired: account deletion, support,
/// the bootstrap/session plumbing, push-device registration, and later the billing verify / restore / manage flows.
/// A typed marker - never route-name matching - so the future allowlist is explicit in code and covered by a test.
/// On its own it changes nothing: it only matters to <see cref="RequireWriteAccessAttribute"/>.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class AllowWhenSubscriptionExpiredAttribute : Attribute
{
}

/// <summary>
/// The reusable gate for content writes (add/edit/delete links, Collections, sharing, invitations, reactions, comments,
/// friends, image uploads, copy/import, public-share writes into an expired owner's Collection). It checks the ACTOR's
/// entitlement via IEntitlementService - never scattered `if (!canWrite)` in controllers, never the legacy Plan.
///
/// While the subscription program is not launched it is a provable no-op (it returns before reading anything), so applying
/// it anywhere changes no behavior today. R39-A applies it to NO endpoint; R39-D turns enforcement on after the stores are
/// proven.
/// </summary>
public sealed class RequireWriteAccessAttribute() : TypeFilterAttribute(typeof(RequireWriteAccessFilter));

public sealed class RequireWriteAccessFilter(
    BillingOptions options,
    IExternalIdentityAccessor externalIdentityAccessor,
    IEntitlementService entitlementService) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!options.ProgramEnabled
            || context.ActionDescriptor.EndpointMetadata.OfType<AllowWhenSubscriptionExpiredAttribute>().Any())
        {
            await next();
            return;
        }

        try
        {
            var entitlement = await entitlementService.GetForIdentityAsync(
                externalIdentityAccessor.GetRequired(), context.HttpContext.RequestAborted);
            if (!EntitlementAccessPolicy.CanWrite(entitlement))
            {
                context.Result = BillingProblems.SubscriptionRequired();
                return;
            }
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // Not bootstrapped yet: the action itself answers that (its existing 409), exactly as before.
        }

        await next();
    }
}
