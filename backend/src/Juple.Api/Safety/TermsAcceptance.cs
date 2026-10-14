using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

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
/// Marks an action that CREATES user-generated content or starts an interaction with another person (saving a link, creating a
/// Collection, a comment, a heart or reaction, a friend request, an invitation, a join request, a photo): the person must have accepted the
/// CURRENT Terms of Service version first - decided here, on the server, never only by the app. Reading, deleting one's own things, account
/// deletion, reporting, blocking and support are never gated.
/// </summary>
[AttributeUsage(AttributeTargets.Method | AttributeTargets.Class, AllowMultiple = false, Inherited = true)]
public sealed class RequireTermsAcceptanceAttribute() : TypeFilterAttribute(typeof(RequireTermsAcceptanceFilter));

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
