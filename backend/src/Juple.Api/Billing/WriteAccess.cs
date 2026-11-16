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

    /// <summary>The ACTING person is fine, but the Collection's OWNER has no live access: nothing can be added to or changed in it for now.</summary>
    public const string CollectionOwnerSubscriptionRequiredCode = "collectionOwnerSubscriptionRequired";

    public static ObjectResult SubscriptionRequired() => Forbidden(SubscriptionRequiredCode, "A subscription is required to change content.");

    public static ObjectResult CollectionOwnerSubscriptionRequired() =>
        Forbidden(CollectionOwnerSubscriptionRequiredCode, "This Collection's owner needs a subscription before it can be changed.");

    private static ObjectResult Forbidden(string code, string title)
    {
        var problem = new ProblemDetails { Status = StatusCodes.Status403Forbidden, Title = title };
        problem.Extensions["code"] = code;
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
/// Declares that a write acts on a COLLECTION'S content (adding, editing or removing links, sharing, collaboration, public-link
/// writes) and where the Collection comes from: route values (<see cref="RouteIds"/>), properties of the bound request
/// (<see cref="RequestProperties"/>, a long or a list of longs) or an active public link id (<see cref="PublicIdRoute"/>). For these
/// writes BOTH the acting person AND the Collection's owner must have live access; an owner acting on their own Collection is one
/// check. Reading a Collection is never affected. Unknown Collections are left to the action's own 404.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class CollectionOwnedWriteAttribute : Attribute
{
    public string[] RouteIds { get; init; } = [];

    public string[] RequestProperties { get; init; } = [];

    public string? PublicIdRoute { get; init; }

    /// <summary>A route value holding a pending invitation id - the Collection is the one the invitation would join.</summary>
    public string? InvitationIdRoute { get; init; }

    /// <summary>A request property holding a merge operation token (a Guid) - the Collections are the ones that merge touched.</summary>
    public string? MergeOperationProperty { get; init; }
}

/// <summary>
/// Records that an ANONYMOUS endpoint which mutates something was reviewed for the subscription gate and deliberately stays
/// ungated (<see cref="Reason"/> says why). A test requires it on every anonymous mutating action, so none passes unreviewed.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false, Inherited = false)]
public sealed class AnonymousMutationReviewedAttribute(string reason) : Attribute
{
    public string Reason { get; } = reason;
}

/// <summary>
/// The reusable gate for content writes (add/edit/delete links, Collections, sharing, invitations, reactions, comments,
/// friends, image uploads, copy/import, public-share writes into an expired owner's Collection). It checks the ACTOR's
/// entitlement via IEntitlementService - never scattered `if (!canWrite)` in controllers, never the legacy Plan.
///
/// While the subscription program is not launched it is a provable no-op (it returns before reading anything). Applied on a
/// controller it gates only that controller's MUTATING actions (POST / PUT / PATCH / DELETE): reads (GET / HEAD / OPTIONS) and
/// anonymous requests are never gated, so an Expired person keeps reading everything they already have. An action (or a whole
/// controller) that must stay usable carries <see cref="AllowWhenSubscriptionExpiredAttribute"/>; a test requires every mutating
/// action of an authenticated controller to be one or the other, so a new endpoint cannot silently skip the decision.
/// </summary>
public sealed class RequireWriteAccessAttribute() : TypeFilterAttribute(typeof(RequireWriteAccessFilter));

public sealed class RequireWriteAccessFilter(
    BillingOptions options,
    IExternalIdentityAccessor externalIdentityAccessor,
    IEntitlementService entitlementService,
    ICurrentJupleUserAccessor currentUserAccessor,
    ICollectionOwnerLookup ownerLookup) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!options.ProgramEnabled
            || IsSafeMethod(context.HttpContext.Request.Method)
            || context.HttpContext.User.Identity?.IsAuthenticated != true
            || context.ActionDescriptor.EndpointMetadata.OfType<AllowWhenSubscriptionExpiredAttribute>().Any())
        {
            await next();
            return;
        }

        try
        {
            var identity = externalIdentityAccessor.GetRequired();
            var entitlement = await entitlementService.GetForIdentityAsync(identity, context.HttpContext.RequestAborted);
            if (!EntitlementAccessPolicy.CanWrite(entitlement))
            {
                context.Result = BillingProblems.SubscriptionRequired();
                return;
            }

            // The actor is fine. A write into a Collection also needs the Collection's OWNER to have live access.
            var owned = context.ActionDescriptor.EndpointMetadata.OfType<CollectionOwnedWriteAttribute>().LastOrDefault();
            if (owned is not null)
            {
                var actor = await currentUserAccessor.GetRequiredAsync(identity, context.HttpContext.RequestAborted);
                foreach (var ownerId in await FindOwnersAsync(context, owned, context.HttpContext.RequestAborted))
                {
                    if (ownerId == actor.UserId)
                    {
                        continue;
                    }

                    var ownerEntitlement = await entitlementService.GetForUserAsync(ownerId, context.HttpContext.RequestAborted);
                    if (!EntitlementAccessPolicy.CanWrite(ownerEntitlement))
                    {
                        context.Result = BillingProblems.CollectionOwnerSubscriptionRequired();
                        return;
                    }
                }
            }
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // Not bootstrapped yet: the action itself answers that (its existing 409), exactly as before.
        }

        await next();
    }

    private async Task<IReadOnlyCollection<long>> FindOwnersAsync(ActionExecutingContext context, CollectionOwnedWriteAttribute owned, CancellationToken cancellationToken)
    {
        var collectionIds = new HashSet<long>();
        foreach (var key in owned.RouteIds)
        {
            if (context.RouteData.Values.TryGetValue(key, out var raw)
                && long.TryParse(Convert.ToString(raw, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture, out var id))
            {
                collectionIds.Add(id);
            }
        }

        foreach (var argument in context.ActionArguments.Values)
        {
            if (argument is null)
            {
                continue;
            }

            foreach (var name in owned.RequestProperties)
            {
                switch (argument.GetType().GetProperty(name)?.GetValue(argument))
                {
                    case long single:
                        collectionIds.Add(single);
                        break;
                    case IEnumerable<long> many:
                        collectionIds.UnionWith(many);
                        break;
                }
            }
        }

        var owners = new HashSet<long>();

        if (owned.InvitationIdRoute is { } invitationKey
            && context.RouteData.Values.TryGetValue(invitationKey, out var invitationRaw)
            && long.TryParse(Convert.ToString(invitationRaw, System.Globalization.CultureInfo.InvariantCulture), System.Globalization.CultureInfo.InvariantCulture, out var invitationId)
            && await ownerLookup.FindOwnerUserIdByInvitationAsync(invitationId, cancellationToken) is { } invitationOwner)
        {
            owners.Add(invitationOwner);
        }

        if (owned.MergeOperationProperty is { } operationProperty)
        {
            foreach (var argument in context.ActionArguments.Values)
            {
                if (argument?.GetType().GetProperty(operationProperty)?.GetValue(argument) is Guid token)
                {
                    owners.UnionWith(await ownerLookup.FindOwnerUserIdsByMergeOperationAsync(token, cancellationToken));
                }
            }
        }

        foreach (var collectionId in collectionIds)
        {
            if (await ownerLookup.FindOwnerUserIdAsync(collectionId, cancellationToken) is { } ownerId)
            {
                owners.Add(ownerId);
            }
        }

        if (owned.PublicIdRoute is { } publicKey
            && context.RouteData.Values.TryGetValue(publicKey, out var publicRaw)
            && publicRaw is string publicId
            && await ownerLookup.FindOwnerUserIdByPublicIdAsync(publicId, cancellationToken) is { } publicOwner)
        {
            owners.Add(publicOwner);
        }

        return owners;
    }

    private static bool IsSafeMethod(string method) =>
        HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method);
}
