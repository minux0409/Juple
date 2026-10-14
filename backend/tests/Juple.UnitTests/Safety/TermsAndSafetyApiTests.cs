using System.Reflection;
using Juple.Api.Controllers;
using Juple.Api.Safety;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.Routing;

namespace Juple.UnitTests.Safety;

/// <summary>The server-side Terms gate, the block mapping and which endpoints carry the gate - decided on the API's own types.</summary>
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

    private static ActionExecutingContext Context(bool authenticated = true)
    {
        var httpContext = new DefaultHttpContext();
        httpContext.Request.Method = "POST";
        if (authenticated)
        {
            httpContext.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        }

        return new ActionExecutingContext(
            new ActionContext(httpContext, new RouteData(), new ActionDescriptor()), new List<IFilterMetadata>(), new Dictionary<string, object?>(), new object());
    }

    private static async Task<(bool NextCalled, IActionResult? Result)> RunAsync(FakeTerms terms, ActionExecutingContext context, bool bootstrapped = true)
    {
        var nextCalled = false;
        await new RequireTermsAcceptanceFilter(new Identity(), new Users(bootstrapped), terms).OnActionExecutionAsync(
            context,
            () =>
            {
                nextCalled = true;
                return Task.FromResult(new ActionExecutedContext(context, context.Filters, context.Controller));
            });
        return (nextCalled, context.Result);
    }

    [Fact]
    public async Task NoAcceptance_IsA403_WithTheStableCode_AndTheActionNeverRuns()
    {
        var (nextCalled, result) = await RunAsync(new FakeTerms(accepted: false), Context());

        Assert.False(nextCalled);
        var objectResult = Assert.IsType<ObjectResult>(result);
        Assert.Equal(403, objectResult.StatusCode);
        Assert.Equal("termsAcceptanceRequired", Assert.IsType<ProblemDetails>(objectResult.Value).Extensions["code"]);
    }

    [Fact]
    public async Task AcceptedUser_PassesThrough_AndAnonymousOrUnbootstrappedRequestsAreLeftToTheAction()
    {
        var accepted = new FakeTerms(accepted: true);
        var (nextCalled, result) = await RunAsync(accepted, Context());
        Assert.True(nextCalled);
        Assert.Null(result);
        Assert.Equal(1, accepted.Checks);

        var anonymous = new FakeTerms(accepted: false);
        Assert.True((await RunAsync(anonymous, Context(authenticated: false))).NextCalled);
        Assert.Equal(0, anonymous.Checks);

        // Not bootstrapped yet: the action's own 409 answers, exactly as before this gate existed.
        Assert.True((await RunAsync(new FakeTerms(accepted: false), Context(), bootstrapped: false)).NextCalled);
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

    // ---- which endpoints carry the gate ----

    private static bool Gated(Type controller, string httpMethodTemplate)
    {
        var method = controller.GetMethods(BindingFlags.Public | BindingFlags.Instance)
            .Single(candidate => candidate.GetCustomAttributes<HttpMethodAttribute>().Any(attribute => attribute.Template == httpMethodTemplate.Split(' ', 2)[1] || (httpMethodTemplate.Split(' ', 2)[1] == string.Empty && attribute.Template is null))
                && candidate.GetCustomAttributes<HttpMethodAttribute>().Any(attribute => attribute.HttpMethods.Contains(httpMethodTemplate.Split(' ', 2)[0])));
        return method.GetCustomAttribute<RequireTermsAcceptanceAttribute>() is not null || controller.GetCustomAttribute<RequireTermsAcceptanceAttribute>() is not null;
    }

    [Theory]
    [InlineData(typeof(InboxController), "POST ")]
    [InlineData(typeof(CollectionsController), "POST ")]
    [InlineData(typeof(CollectionsController), "POST {id:long}/invitations")]
    [InlineData(typeof(CollectionsController), "PUT {id:long}/items/{itemId:long}")]
    [InlineData(typeof(CollectionsController), "PUT {id:long}/items/{itemId:long}/reaction")]
    [InlineData(typeof(CollectionsController), "POST {id:long}/items/{itemId:long}/comments")]
    [InlineData(typeof(CollectionsController), "PUT {id:long}/items/{itemId:long}/comments/{commentId:long}/like")]
    [InlineData(typeof(FriendsController), "POST requests")]
    [InlineData(typeof(FriendsController), "POST requests/{requestId:long}/accept")]
    [InlineData(typeof(CollectionInvitationsController), "POST collection-invitations/{invitationId:long}/accept")]
    [InlineData(typeof(PublicShareWriteController), "POST join-requests")]
    [InlineData(typeof(PublicShareWriteController), "POST save")]
    [InlineData(typeof(ItemCollectionsController), "POST ")]
    [InlineData(typeof(ItemImagesController), "POST ")]
    public void ContentCreatingEndpoints_CarryTheTermsGate(Type controller, string route) => Assert.True(Gated(controller, route), $"{controller.Name} {route}");

    [Fact]
    public void SafetyEndpoints_AreNeverTermsGated_AndAlwaysWorkForAnExpiredSubscription()
    {
        Assert.Null(typeof(SafetyController).GetCustomAttribute<RequireTermsAcceptanceAttribute>());
        Assert.All(typeof(SafetyController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly),
            method => Assert.Null(method.GetCustomAttribute<RequireTermsAcceptanceAttribute>()));
        Assert.NotNull(typeof(SafetyController).GetCustomAttribute<Juple.Api.Billing.AllowWhenSubscriptionExpiredAttribute>());
    }
}
