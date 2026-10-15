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
/// Marks an authenticated endpoint (or a whole controller) that stays usable BEFORE the current Terms were accepted. The Terms are accepted
/// once, right after sign-in and before the app's first screen (the Agreement screen), so everything else needs them: this allowlist is
/// exactly what the agreement flow itself and the sign-in lifecycle need - bootstrap, the terms status / acceptance, the session check,
/// push-device registration / cleanup and account deletion. A test pins the complete list; a new endpoint is gated unless it is added here.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = false, Inherited = true)]
public sealed class AllowWithoutTermsAcceptanceAttribute : Attribute;

/// <summary>
/// Remembers (per API process) that a person accepted a version, so the gate below costs one lookup per person and version instead of one
/// per request. Positive answers only: an acceptance is never withdrawn, and a different current version is a different key.
/// </summary>
public sealed class TermsAcceptanceCache
{
    private readonly System.Collections.Concurrent.ConcurrentDictionary<(long UserId, string Version), byte> accepted = new();

    private const int MaxEntries = 100_000;

    public bool IsAccepted(long userId, string version) => accepted.ContainsKey((userId, version));

    public void MarkAccepted(long userId, string version)
    {
        if (accepted.Count >= MaxEntries)
        {
            accepted.Clear();
        }

        accepted[(userId, version)] = 0;
    }
}

/// <summary>
/// The Terms gate, applied to every authenticated endpoint (registered as a global MVC filter): a person who has not accepted the CURRENT
/// Terms version gets 403 <c>termsAcceptanceRequired</c> before the action runs - reading and writing alike - except on the endpoints marked
/// <see cref="AllowWithoutTermsAcceptanceAttribute"/>. Anonymous endpoints are never touched. The decision is the server's alone; the app
/// shows the Agreement screen first so a current client never gets here without having accepted. <c>Terms:EnforceAcceptance=false</c>
/// (a rollout window for installed apps that predate the Agreement screen) switches the whole gate off without reading anything.
/// </summary>
public sealed class RequireTermsAcceptanceFilter(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    ITermsConsentService termsService,
    TermsOptions options,
    TermsAcceptanceCache cache) : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        if (!options.EnforceAcceptance
            || context.HttpContext.User.Identity?.IsAuthenticated != true
            || context.ActionDescriptor.EndpointMetadata.OfType<AllowWithoutTermsAcceptanceAttribute>().Any()
            || context.ActionDescriptor.EndpointMetadata.OfType<Microsoft.AspNetCore.Authorization.IAllowAnonymous>().Any())
        {
            await next();
            return;
        }

        try
        {
            var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), context.HttpContext.RequestAborted);
            if (!cache.IsAccepted(user.UserId, options.CurrentVersion))
            {
                await termsService.RequireAcceptedAsync(user.UserId, context.HttpContext.RequestAborted);
                cache.MarkAccepted(user.UserId, options.CurrentVersion);
            }
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
