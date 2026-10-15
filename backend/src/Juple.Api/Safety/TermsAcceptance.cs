using Juple.Application.Identity;
using Juple.Application.Collections;
using Juple.Application.Collections.GetCollectionDetail;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Extensions.DependencyInjection;

namespace Juple.Api.Safety;

/// <summary>The stable machine-readable codes of the safety module (403 like every other "you may not do this" outcome in this API).</summary>
public static class SafetyProblems
{
    public const string TermsAcceptanceRequiredCode = "termsAcceptanceRequired";
    public const string UserBlockedCode = "userBlocked";

    public static ObjectResult TermsAcceptanceRequired() =>
        Create(StatusCodes.Status403Forbidden, "The current Terms of Service must be accepted first.", TermsAcceptanceRequiredCode);

    /// <summary>The CALLER blocked this person: they know, so the answer is explicit (and they can unblock).</summary>
    public static ObjectResult BlockedByYou() =>
        Create(StatusCodes.Status403Forbidden, "You blocked this person. Unblock them to interact.", UserBlockedCode);

    public static ObjectResult Create(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}

/// <summary>
/// Marks an action that publishes content to other users or starts a social interaction: the person must have accepted the
/// CURRENT Terms of Service version first. Private link saving, private Collection creation and private item photos are not gated.
/// Reading, deleting one's own things, account deletion, reporting, blocking and support are never gated.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false, Inherited = true)]
public sealed class RequireTermsAcceptanceAttribute() : TypeFilterAttribute(typeof(RequireTermsAcceptanceFilter));

/// <summary>
/// A link or item may be saved into a private Collection without accepting UGC Terms. When any destination is
/// shared, the same write is visible to others and needs the current Terms. Missing/forbidden Collection ids
/// fall through to the action's existing 404/403 handling.
/// </summary>
[AttributeUsage(AttributeTargets.Method, AllowMultiple = false)]
public sealed class RequireTermsForSharedCollectionWritesAttribute(string idsFrom) : Attribute, IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.User.Identity?.IsAuthenticated != true)
        {
            await next();
            return;
        }

        IReadOnlyList<long> ids;
        if (idsFrom == "route")
        {
            ids = long.TryParse(context.RouteData.Values["id"]?.ToString(), out var id) ? [id] : [];
        }
        else
        {
            context.ActionArguments.TryGetValue("request", out var body);
            var value = body?.GetType().GetProperty(idsFrom)?.GetValue(body);
            ids = value switch
            {
                long id => [id],
                IEnumerable<long> many => many.ToArray(),
                _ => [],
            };
        }

        if (ids.Count == 0)
        {
            await next();
            return;
        }

        var services = context.HttpContext.RequestServices;
        try
        {
            var identity = services.GetRequiredService<IExternalIdentityAccessor>().GetRequired();
            var user = await services.GetRequiredService<ICurrentJupleUserAccessor>().GetRequiredAsync(identity, context.HttpContext.RequestAborted);
            var collections = services.GetRequiredService<IGetCollectionDetailService>();
            var shares = services.GetRequiredService<IGetCollectionShareService>();
            foreach (var id in ids.Distinct())
            {
                var collection = await collections.GetAsync(user.UserId, id, context.HttpContext.RequestAborted);
                var isShared = collection.AccessRole != CollectionDtoAccessRoles.Owner
                    || collection.HasCollaborators
                    || collection.IsPublicShareActive
                    || await shares.GetAsync(user.UserId, id, context.HttpContext.RequestAborted) is not null;
                if (!isShared)
                {
                    continue;
                }

                await services.GetRequiredService<ITermsConsentService>().RequireAcceptedAsync(user.UserId, context.HttpContext.RequestAborted);
                break;
            }
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // The action preserves its existing bootstrap-required response.
        }
        catch (CollectionNotFoundException)
        {
            // The action preserves its existing Collection-not-found response.
        }
        catch (TermsAcceptanceRequiredException)
        {
            context.Result = SafetyProblems.TermsAcceptanceRequired();
            return;
        }

        await next();
    }
}

public sealed class RequireTermsAcceptanceFilter(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ITermsConsentService termsService) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (context.HttpContext.User.Identity?.IsAuthenticated != true)
        {
            await next();
            return;
        }

        try
        {
            var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), context.HttpContext.RequestAborted);
            await termsService.RequireAcceptedAsync(user.UserId, context.HttpContext.RequestAborted);
        }
        catch (CurrentJupleUserNotFoundException)
        {
            // Not bootstrapped yet: the action itself answers that (its existing 409), exactly as before.
        }
        catch (TermsAcceptanceRequiredException)
        {
            context.Result = SafetyProblems.TermsAcceptanceRequired();
            return;
        }

        await next();
    }
}

/// <summary>
/// Maps <see cref="UserBlockedException"/> (raised by the services / stores that enforce a block) to its 403 for every controller. When the
/// CALLER blocked the person the answer says so (<c>userBlocked</c>); when the other person blocked the caller it is the neutral
/// <c>interactionNotAllowed</c> - a block is never revealed to the one it is set against.
/// </summary>
public sealed class UserBlockedExceptionFilter : IExceptionFilter
{
    public const string InteractionNotAllowedCode = "interactionNotAllowed";

    public void OnException(ExceptionContext context)
    {
        if (context.Exception is not UserBlockedException blocked)
        {
            return;
        }

        context.Result = blocked.BlockedByCaller
            ? SafetyProblems.BlockedByYou()
            : SafetyProblems.Create(StatusCodes.Status403Forbidden, "This action is not available.", InteractionNotAllowedCode);
        context.ExceptionHandled = true;
    }
}
