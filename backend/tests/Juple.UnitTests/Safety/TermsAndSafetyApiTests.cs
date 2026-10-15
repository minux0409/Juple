using System.Reflection;
using Juple.Api.Safety;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Routing;

namespace Juple.UnitTests.Safety;

/// <summary>The server-side Terms gate (every authenticated endpoint except the pinned allowlist) and the block mapping.</summary>
public sealed class TermsAndSafetyApiTests
{
    private sealed class Identity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class Users(bool bootstrapped = true) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            bootstrapped
                ? Task.FromResult(new CurrentJupleUser(7, "UTC", default))
                : throw new CurrentJupleUserNotFoundException();
    }

    private sealed class FakeTerms(bool accepted) : ITermsConsentService
    {
        public int Checks { get; private set; }

        public Task<TermsStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<TermsStatusDto> AcceptAsync(long userId, string? version, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task RequireAcceptedAsync(long userId, CancellationToken cancellationToken = default)
        {
            Checks++;
            return accepted ? Task.CompletedTask : throw new TermsAcceptanceRequiredException();
        }
    }

    private static ActionExecutingContext Context(bool authenticated = true, params object[] endpointMetadata)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = "GET";
        if (authenticated)
        {
            httpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        }

        return new ActionExecutingContext(
            new ActionContext(httpContext, new RouteData(), new ActionDescriptor { EndpointMetadata = endpointMetadata }),
            new List<IFilterMetadata>(),
            new Dictionary<string, object?>(),
            new object());
    }

    private static async Task<(bool NextCalled, IActionResult? Result)> RunAsync(
        FakeTerms terms,
        ActionExecutingContext context,
        bool bootstrapped = true,
        bool enforce = true,
        TermsAcceptanceCache? cache = null)
    {
        var nextCalled = false;
        var options = new TermsOptions { EnforceAcceptance = enforce };
        await new RequireTermsAcceptanceFilter(new Identity(), new Users(bootstrapped), terms, options, cache ?? new TermsAcceptanceCache()).OnActionExecutionAsync(
            context,
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new ActionExecutedContext(context, context.Filters, context.Controller));
            });
        return (nextCalled, context.Result);
    }

    [Fact]
    public async Task NoAcceptance_IsA403_WithTheStableCode_AndTheActionNeverRuns_AlsoForARead()
    {
        var (nextCalled, result) = await RunAsync(new FakeTerms(accepted: false), Context());

        Assert.False(nextCalled);
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, objectResult.StatusCode);
        Assert.Equal("termsAcceptanceRequired", Assert.IsType<ProblemDetails>(objectResult.Value).Extensions["code"]);
    }

    [Fact]
    public async Task AcceptedUser_PassesThrough_AndIsRememberedPerVersion()
    {
        var accepted = new FakeTerms(accepted: true);
        var cache = new TermsAcceptanceCache();
        Assert.True((await RunAsync(accepted, Context(), cache: cache)).NextCalled);
        Assert.True((await RunAsync(accepted, Context(), cache: cache)).NextCalled);
        Assert.Equal(1, accepted.Checks);

        // A newer current version is a different key: the person is asked again.
        Assert.True(cache.IsAccepted(7, TermsOptions.DefaultVersion));
        Assert.False(cache.IsAccepted(7, "2099-01-01"));
    }

    [Fact]
    public async Task AllowlistedAnonymousUnbootstrappedAndDisabledRequestsAreNeverBlocked()
    {
        var blocking = new FakeTerms(accepted: false);

        // The Agreement flow's own endpoints (and the sign-in lifecycle).
        Assert.True((await RunAsync(blocking, Context(true, new AllowWithoutTermsAcceptanceAttribute()))).NextCalled);

        // Anonymous callers and anonymous endpoints are never touched.
        Assert.True((await RunAsync(blocking, Context(authenticated: false))).NextCalled);
        Assert.True((await RunAsync(blocking, Context(true, new AllowAnonymousAttribute()))).NextCalled);

        // Not bootstrapped yet: the action's own 409 answers, exactly as before this gate existed.
        Assert.True((await RunAsync(blocking, Context(), bootstrapped: false)).NextCalled);

        // The rollout switch turns the whole gate off without reading anything.
        Assert.True((await RunAsync(blocking, Context(), enforce: false)).NextCalled);
        Assert.Equal(0, blocking.Checks);
    }

    /// <summary>
    /// The complete list of actions that work before the Terms are accepted. Everything else on an authenticated controller is gated by
    /// the global filter. Adding to this list is a product/legal decision - this test makes it a visible one.
    /// </summary>
    [Fact]
    public void TheEndpointsThatWorkBeforeAcceptance_AreExactlyTheAgreementAndSignInLifecycle()
    {
        var allowed = typeof(RequireTermsAcceptanceFilter).Assembly.GetTypes()
            .Where(type => type.IsSubclassOf(typeof(ControllerBase)) && !type.IsAbstract)
            .SelectMany(type => type.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
                .Where(method => method.GetCustomAttributes<HttpMethodAttribute>().Any())
                .Where(method => method.GetCustomAttribute<AllowWithoutTermsAcceptanceAttribute>() is not null
                    || type.GetCustomAttribute<AllowWithoutTermsAcceptanceAttribute>() is not null)
                .Select(method => $"{type.Name}.{method.Name}"))
            .OrderBy(name => name, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            [
                "AccountController.DeleteAsync",
                "AuthSessionController.Get",
                "CurrentUserBootstrapController.BootstrapAsync",
                "PushDevicesController.RegisterAsync",
                "PushDevicesController.UnregisterAsync",
                "SafetyController.AcceptTermsAsync",
                "SafetyController.GetTermsAsync",
            ],
            allowed);
    }

    [Fact]
    public void ABlockIsNeverRevealedToTheBlockedPerson()
    {
        var byCaller = new ExceptionContext(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>()) { Exception = new UserBlockedException(true) };
        new UserBlockedExceptionFilter().OnException(byCaller);
        Assert.Equal("userBlocked", Assert.IsType<ProblemDetails>(Assert.IsType<ObjectResult>(byCaller.Result).Value).Extensions["code"]);
        Assert.True(byCaller.ExceptionHandled);

        var byOther = new ExceptionContext(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>()) { Exception = new UserBlockedException(false) };
        new UserBlockedExceptionFilter().OnException(byOther);
        var problem = Assert.IsType<ProblemDetails>(Assert.IsType<ObjectResult>(byOther.Result).Value);
        Assert.Equal("interactionNotAllowed", problem.Extensions["code"]);
        Assert.DoesNotContain("block", problem.Title!, StringComparison.OrdinalIgnoreCase);

        var unrelated = new ExceptionContext(new ActionContext(new DefaultHttpContext(), new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>()) { Exception = new InvalidOperationException() };
        new UserBlockedExceptionFilter().OnException(unrelated);
        Assert.Null(unrelated.Result);
    }
}
