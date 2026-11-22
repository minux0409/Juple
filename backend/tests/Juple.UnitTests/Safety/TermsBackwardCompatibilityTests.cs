using System.Reflection;
using System.Text.Json;
using Juple.Api.Controllers;
using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Abstractions;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Routing;
using Juple.Api.Safety;
using Juple.Domain.Users;

namespace Juple.UnitTests.Safety;

public sealed class TermsBackwardCompatibilityTests
{
    [Fact]
    public void LoadedUserAlsoProtectsAnAcceptanceThatChangedAfterAnEarlierStatusRead()
    {
        var at = DateTimeOffset.UtcNow.AddDays(-1);
        var user = new User("ko", "UTC", null, at, at);
        Assert.True(user.TryAcceptTermsPreservingVersion("2026-10-14", at));
        Assert.True(user.TryAcceptTermsPreservingVersion("2026-10-14", at.AddHours(1)));
        Assert.Equal(at, user.TermsAcceptedAtUtc);
        user.AcceptTerms("2026-10-25", at.AddHours(2));
        Assert.False(user.TryAcceptTermsPreservingVersion("2026-10-14", at.AddHours(3)));
        Assert.Equal("2026-10-25", user.AcceptedTermsVersion);
        Assert.Equal(at.AddHours(2), user.TermsAcceptedAtUtc);
    }
    public class Stub : DispatchProxy
    {
        public Func<MethodInfo, object?[]?, object?> Call = null!;
        protected override object? Invoke(MethodInfo? method, object?[]? args) => Call(method!, args);
    }
    private static T Mock<T>(Func<MethodInfo, object?[]?, object?> call) where T : class
    {
        var value = DispatchProxy.Create<T, Stub>();
        ((Stub)(object)value).Call = call;
        return value;
    }
    private sealed class State
    {
        public string? Version;
        public DateTimeOffset? At;
        public int Writes;
        public TermsConsentService Service(string current, bool enforce = false) => new(
            Mock<ISafetyStore>((method, args) => method.Name switch
            {
                nameof(ISafetyStore.GetTermsAsync) => Task.FromResult((Version, At)),
                nameof(ISafetyStore.SetTermsAsync) => Save((string)args![1]!, (DateTimeOffset)args[2]!),
                _ => throw new InvalidOperationException("Unexpected access outside terms")
            }), new TermsOptions { CurrentVersion = current, EnforceAcceptance = enforce }, TimeProvider.System);
        private Task<(string, DateTimeOffset)> Save(string version, DateTimeOffset at)
        {
            Writes++;
            if (Version != version || At is null) { Version = version; At = at; }
            return Task.FromResult((Version!, At!.Value));
        }
    }
    private static SafetyController Controller(State state, string current) => new(
        Mock<IExternalIdentityAccessor>((_, _) => new ExternalIdentityPrincipal(Guid.NewGuid(), Guid.NewGuid())),
        Mock<ICurrentJupleUserAccessor>((_, args) => Task.FromResult(new CurrentJupleUser(7, "UTC", default))),
        state.Service(current), null!, null!);
    private static SafetyController.AcceptTermsRequest Request(string json) =>
        JsonSerializer.Deserialize<SafetyController.AcceptTermsRequest>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task BothStatusContractsExposeEnforcementWithoutChangingAcceptance(bool enforce)
    {
        var state = new State();
        var status = await state.Service("2026-10-14", enforce).GetStatusAsync(7);
        Assert.Equal(enforce, status.EnforceAcceptance);
        Assert.False(status.IsAccepted); Assert.Null(status.AcceptedVersion); Assert.Equal(0, state.Writes);
        Assert.Equal(enforce, SafetyController.TermsResponse.From(status).EnforceAcceptance);
        Assert.Equal(enforce, CurrentUserBootstrapController.TermsStatusResponse.From(status).EnforceAcceptance);
        var wire = JsonSerializer.SerializeToElement(SafetyController.TermsResponse.From(status), new JsonSerializerOptions(JsonSerializerDefaults.Web));
        Assert.Equal(enforce, wire.GetProperty("enforceAcceptance").GetBoolean());
        Assert.False(wire.GetProperty("isAccepted").GetBoolean());
    }

    [Fact]
    public async Task Android42AndIos11RequestShapeAcceptsOnlyTheHistoricalCurrentVersion()
    {
        var state = new State();
        var request = Request("""{"version":"2026-10-14","isAtLeast14":true}""");
        Assert.True(request.IsLegacyFormat);
        Assert.Null(request.LanguageText); // A language-less request is not relabelled Korean.
        var result = Assert.IsType<OkObjectResult>(await Controller(state, "2026-10-14").AcceptTermsAsync(request, default));
        Assert.Equal("2026-10-14", Assert.IsType<SafetyController.TermsResponse>(result.Value).AcceptedVersion);
        Assert.False(Assert.IsType<SafetyController.TermsResponse>(result.Value).EnforceAcceptance);
        Assert.Equal("2026-10-14", state.Version);
        Assert.Equal(1, state.Writes);
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("POST")]
    public async Task AgeRejectionDoesNotEnableTheGlobalGateDuringTheOffRollout(string method)
    {
        var state = new State();
        var rejected = Assert.IsType<ObjectResult>(await Controller(state, "2026-10-14").AcceptTermsAsync(Request("""{"version":"2026-10-14"}"""), default));
        Assert.Equal(400, rejected.StatusCode); Assert.Equal(0, state.Writes);
        var http = new DefaultHttpContext(); http.Request.Method = method;
        http.User = new System.Security.Claims.ClaimsPrincipal(new System.Security.Claims.ClaimsIdentity("test"));
        var context = new ActionExecutingContext(new ActionContext(http, new RouteData(), new ActionDescriptor { EndpointMetadata = [] }), [], new Dictionary<string, object?>(), new object());
        var filter = new RequireTermsAcceptanceFilter(null!, null!, state.Service("2026-10-14"), new TermsOptions { EnforceAcceptance = false }, new TermsAcceptanceCache());
        var next = false;
        await filter.OnActionExecutionAsync(context, () => { next = true; return Task.FromResult(new ActionExecutedContext(context, [], context.Controller)); });
        Assert.True(next); Assert.Null(context.Result); Assert.Null(state.Version); Assert.Equal(0, state.Writes);
    }

    [Theory]
    [InlineData("2026-10-14")]
    [InlineData("2026-10-25")]
    public async Task ModernRequestUsesTheActualDocumentHashAndApprovedLanguage(string version)
    {
        var body = JsonSerializer.SerializeToElement(PublishedTerms.GetDocument(version, "ko"));
        var request = Request(JsonSerializer.Serialize(new { version, isAtLeast14 = true, contentHash = body.GetProperty("contentHash").GetString(), language = "ko" }));
        Assert.False(request.IsLegacyFormat);
        var state = new State();
        Assert.IsType<OkObjectResult>(await Controller(state, version).AcceptTermsAsync(request, default));
        Assert.Equal(version, state.Version);
    }

    [Theory]
    [InlineData("2026-10-14", "2026-10-25", "ko")]
    [InlineData("2026-10-25", "2026-10-14", "ko")]
    [InlineData("2026-10-14", "2026-10-14", "en")]
    [InlineData("2026-10-25", "2026-10-25", "en")]
    public async Task CrossVersionHashAndUnapprovedLanguageAreRejected(string version, string hashVersion, string language)
    {
        var document = JsonSerializer.SerializeToElement(PublishedTerms.GetDocument(hashVersion, "ko"));
        var request = Request(JsonSerializer.Serialize(new { version, isAtLeast14 = true, contentHash = document.GetProperty("contentHash").GetString(), language }));
        var state = new State();
        var response = Assert.IsType<ObjectResult>(await Controller(state, version).AcceptTermsAsync(request, default));
        Assert.Equal("termsDocumentMismatch", Assert.IsType<ProblemDetails>(response.Value).Extensions["code"]);
        Assert.Equal(0, state.Writes);
    }

    [Theory]
    [InlineData("""{"version":"2026-10-14","isAtLeast14":true,"contentHash":null,"language":null}""")]
    [InlineData("""{"version":"2026-10-14","isAtLeast14":true,"contentHash":"wrong"}""")]
    [InlineData("""{"version":"2026-10-14","isAtLeast14":true,"language":"ko"}""")]
    [InlineData("""{"version":"2026-10-14","isAtLeast14":true,"contentHash":12,"language":false}""")]
    [InlineData("""{"version":"2026-10-25","isAtLeast14":true}""")]
    public async Task PartialNullWrongTypedOrNewVersionRequestsCannotDowngradeToLegacy(string json)
    {
        var state = new State();
        var result = Assert.IsAssignableFrom<ObjectResult>(await Controller(state, "2026-10-14").AcceptTermsAsync(Request(json), default));
        Assert.Equal(400, result.StatusCode);
        Assert.Equal(0, state.Writes);
    }

    [Theory]
    [InlineData("""{"version":"2026-10-14"}""")]
    [InlineData("""{"version":"2026-10-14","isAtLeast14":false}""")]
    public async Task LegacyDoesNotBypassAgeConfirmation(string json)
    {
        var state = new State();
        var result = Assert.IsType<ObjectResult>(await Controller(state, "2026-10-14").AcceptTermsAsync(Request(json), default));
        Assert.Equal("minimumAgeConfirmationRequired", Assert.IsType<ProblemDetails>(result.Value).Extensions["code"]);
        Assert.Equal(0, state.Writes);
    }

    [Fact]
    public async Task DuplicateLegacyConsentPreservesTheOriginalTimestampWithoutWriting()
    {
        var at = new DateTimeOffset(2026, 10, 14, 0, 0, 0, TimeSpan.Zero);
        var state = new State { Version = "2026-10-14", At = at };
        var controller = Controller(state, "2026-10-14");
        for (var i = 0; i < 2; i++)
        {
            var result = Assert.IsType<OkObjectResult>(await controller.AcceptTermsAsync(Request("""{"version":"2026-10-14","isAtLeast14":true}"""), default));
            Assert.Equal(at, Assert.IsType<SafetyController.TermsResponse>(result.Value).AcceptedAtUtc);
        }
        var document = JsonSerializer.SerializeToElement(PublishedTerms.GetDocument("2026-10-14", "ko"));
        var modern = Request(JsonSerializer.Serialize(new { version = "2026-10-14", isAtLeast14 = true, contentHash = document.GetProperty("contentHash").GetString(), language = "ko" }));
        var repeated = Assert.IsType<OkObjectResult>(await controller.AcceptTermsAsync(modern, default));
        Assert.Equal(at, Assert.IsType<SafetyController.TermsResponse>(repeated.Value).AcceptedAtUtc);
        Assert.Equal(0, state.Writes);
    }

    [Theory]
    [InlineData("2026-10-25", null)]
    [InlineData("2026-10-14", "2026-10-25")]
    public async Task HistoricalRequestNeverPromotesToANewPolicyOrOverwritesAnotherAcceptance(string current, string? accepted)
    {
        var at = DateTimeOffset.UtcNow.AddDays(-1);
        var state = new State { Version = accepted, At = at };
        var result = Assert.IsAssignableFrom<ObjectResult>(await Controller(state, current).AcceptTermsAsync(Request("""{"version":"2026-10-14","isAtLeast14":true}"""), default));
        Assert.Equal(400, result.StatusCode);
        Assert.Equal(accepted, state.Version); Assert.Equal(at, state.At); Assert.Equal(0, state.Writes);
    }

    [Fact]
    public void UnknownFieldCannotSelectAnImplicitLegacyFormatAndAuthenticationIsUnchanged()
    {
        Assert.Throws<JsonException>(() => Request("""{"version":"2026-10-14","isAtLeast14":true,"content_hash":"wrong"}"""));
        Assert.Throws<JsonException>(() => Request("""{"version":"2026-10-14","isAtLeast14":true,"userId":999}"""));
        Assert.Equal(AuthorizationPolicies.JupleUser, typeof(SafetyController).GetCustomAttribute<AuthorizeAttribute>()!.Policy);
    }
}
