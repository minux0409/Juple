using System.Reflection;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Juple.Application.Identity;
using Juple.Application.Support;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Routing;
using Microsoft.AspNetCore.RateLimiting;

namespace Juple.UnitTests.Support;

/// <summary>
/// The support inquiry endpoints: signed-in users only, the owner always taken from the authenticated principal (a
/// request has no user id to trust), foreign ids a plain 404 - and no answer route for anyone, because no secure
/// admin/operator authorization exists to guard one.
/// </summary>
public sealed class SupportInquiriesControllerTests
{
    private const long AuthenticatedUserId = 42;

    private sealed class FakeIdentity : IExternalIdentityAccessor
    {
        public ExternalIdentityPrincipal GetRequired() => new(Guid.NewGuid(), Guid.NewGuid());
    }

    private sealed class FakeCurrentUser(bool bootstrapped = true) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            bootstrapped
                ? Task.FromResult(new CurrentJupleUser(AuthenticatedUserId, "UTC", default))
                : throw new CurrentJupleUserNotFoundException();
    }

    private sealed class FakeService : ISupportInquiryService
    {
        public Func<long, CreateSupportInquiryCommand, SupportInquiryCreateResult>? OnCreate { get; set; }
        public Func<long, long, SupportInquiryDto>? OnGet { get; set; }
        public long? ListedUserId { get; private set; }
        public long? CreatedForUserId { get; private set; }

        public Task<SupportInquiryCreateResult> CreateAsync(long userId, CreateSupportInquiryCommand command, CancellationToken cancellationToken = default)
        {
            CreatedForUserId = userId;
            return Task.FromResult(OnCreate!(userId, command));
        }

        public Task<SupportInquiryPage> ListAsync(long userId, long? cursor, int? limit, CancellationToken cancellationToken = default)
        {
            ListedUserId = userId;
            return Task.FromResult(new SupportInquiryPage([Dto(1)], 7));
        }

        public Task<SupportInquiryDto> GetAsync(long userId, long inquiryId, CancellationToken cancellationToken = default) =>
            Task.FromResult(OnGet!(userId, inquiryId));

        public Task AnswerAsync(long inquiryId, string? answer, CancellationToken cancellationToken = default) => Task.CompletedTask;
    }

    private static SupportInquiryDto Dto(long id) => new(id, "Bug", "Pending", "content", DateTimeOffset.UtcNow, null, null);

    private static SupportInquiriesController Controller(FakeService service, bool bootstrapped = true) =>
        new(new FakeIdentity(), new FakeCurrentUser(bootstrapped), service) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

    private static SupportInquiriesController.CreateSupportInquiryRequest Request() =>
        new(Guid.NewGuid(), "Bug", "Hello", new SupportInquiriesController.SupportInquiryDiagnosticsRequest("1", "2", "android", "15", "model", "ko"));

    [Fact]
    public void EveryEndpointRequiresASignedInJupleUser()
    {
        var authorize = typeof(SupportInquiriesController).GetCustomAttribute<AuthorizeAttribute>();
        Assert.Equal(AuthorizationPolicies.JupleUser, authorize?.Policy);
        Assert.Null(typeof(SupportInquiriesController).GetCustomAttribute<AllowAnonymousAttribute>());
        Assert.All(
            typeof(SupportInquiriesController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly),
            method => Assert.Null(method.GetCustomAttribute<AllowAnonymousAttribute>()));
    }

    [Fact]
    public void CreatingIsRateLimitedPerIdentity()
    {
        var create = typeof(SupportInquiriesController).GetMethod(nameof(SupportInquiriesController.CreateAsync))!;
        Assert.Equal(RateLimitPolicies.SupportInquiryCreate, create.GetCustomAttribute<EnableRateLimitingAttribute>()?.PolicyName);
    }

    [Fact]
    public void ThereIsNoAnswerOrOtherWriteRoute_OnlyCreateListAndGet()
    {
        var actions = typeof(SupportInquiriesController)
            .GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .Select(method => method.Name)
            .Order()
            .ToArray();
        Assert.Equal(["CreateAsync", "GetAsync", "ListAsync"], actions);

        var routes = typeof(SupportInquiriesController).GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly)
            .SelectMany(method => method.GetCustomAttributes<HttpMethodAttribute>())
            .Select(attribute => attribute.HttpMethods.Single())
            .Order()
            .ToArray();
        Assert.Equal(["GET", "GET", "POST"], routes);
    }

    [Fact]
    public void TheRequestCarriesNoUserIdAndTheDiagnosticsOnlyTheAllowedFacts()
    {
        var requestProperties = typeof(SupportInquiriesController.CreateSupportInquiryRequest).GetProperties().Select(property => property.Name).Order().ToArray();
        Assert.Equal(["ClientRequestId", "Content", "Diagnostics", "Type"], requestProperties);

        var diagnostics = typeof(SupportInquiriesController.SupportInquiryDiagnosticsRequest).GetProperties().Select(property => property.Name).Order().ToArray();
        Assert.Equal(["AppVersion", "BuildNumber", "DeviceModel", "Locale", "OsVersion", "Platform"], diagnostics);
    }

    [Fact]
    public async Task Create_UsesTheAuthenticatedUsersId_AndAnswers201ForANewInquiry()
    {
        var service = new FakeService { OnCreate = (_, _) => new SupportInquiryCreateResult(Dto(5), Created: true) };

        var result = await Controller(service).CreateAsync(Request(), CancellationToken.None);

        Assert.Equal(AuthenticatedUserId, service.CreatedForUserId);
        var created = Assert.IsType<CreatedResult>(result);
        Assert.Equal("/api/v1/support/inquiries/5", created.Location);
    }

    [Fact]
    public async Task Create_ARetryOfTheSameRequestAnswers200WithTheSameInquiry()
    {
        var service = new FakeService { OnCreate = (_, _) => new SupportInquiryCreateResult(Dto(5), Created: false) };

        var result = await Controller(service).CreateAsync(Request(), CancellationToken.None);

        Assert.Equal(5, Assert.IsType<SupportInquiryDto>(Assert.IsType<OkObjectResult>(result).Value).InquiryId);
    }

    [Fact]
    public async Task Create_ValidationFailureIs400WithTheFieldName()
    {
        var service = new FakeService { OnCreate = (_, _) => throw new InvalidSupportInquiryException("content", "content is required.") };

        var result = await Controller(service).CreateAsync(Request(), CancellationToken.None);

        var bad = Assert.IsType<BadRequestObjectResult>(result);
        Assert.Contains("content", Assert.IsType<ValidationProblemDetails>(bad.Value).Errors.Keys);
    }

    [Fact]
    public async Task Create_ReusingARequestIdForAnotherQuestionIs409()
    {
        var service = new FakeService { OnCreate = (_, _) => throw new SupportInquiryClientRequestConflictException() };

        var result = await Controller(service).CreateAsync(Request(), CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsType<ObjectResult>(result).StatusCode);
    }

    [Fact]
    public async Task Get_AForeignOrMissingInquiryIsAPlain404()
    {
        var service = new FakeService { OnGet = (_, _) => throw new SupportInquiryNotFoundException() };

        Assert.IsType<NotFoundResult>(await Controller(service).GetAsync(9, CancellationToken.None));
    }

    [Fact]
    public async Task List_IsForTheAuthenticatedUserAndPagesWithACursorString()
    {
        var service = new FakeService();

        var result = await Controller(service).ListAsync(cursor: null, limit: 20, CancellationToken.None);

        Assert.Equal(AuthenticatedUserId, service.ListedUserId);
        var body = Assert.IsType<SupportInquiriesController.SupportInquiriesResponse>(Assert.IsType<OkObjectResult>(result).Value);
        Assert.Equal("7", body.NextCursor);
    }

    [Fact]
    public async Task AUserWhoHasNotBootstrappedGets409_NeverSomeoneElsesData()
    {
        var service = new FakeService { OnGet = (_, _) => Dto(1) };

        var result = await Controller(service, bootstrapped: false).GetAsync(1, CancellationToken.None);

        Assert.Equal(StatusCodes.Status409Conflict, Assert.IsType<ObjectResult>(result).StatusCode);
    }
}
