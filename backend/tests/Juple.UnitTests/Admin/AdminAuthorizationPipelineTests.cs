using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Controllers.Admin;
using Juple.Application.Admin;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Admin;
using Juple.Domain.Users;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Admin;

/// <summary>
/// The Admin API through the REAL ASP.NET Core pipeline (Kestrel on 127.0.0.1, routing, MVC authorization filters, the real
/// JupleAdmin policy, ActiveAdminAuthorizationHandler and admin controllers). Only token validation is replaced: a test scheme turns
/// a header into the same claims Entra's token would carry (tid, oid, scp). The grant table is a fake store.
/// </summary>
public sealed class AdminAuthorizationPipelineTests : IAsyncLifetime
{
    private const string Scope = "access_as_user";
    private static readonly Guid Tenant = Guid.NewGuid();

    private static readonly Guid AdminOid = Guid.NewGuid();
    private static readonly Guid InactiveAdminOid = Guid.NewGuid();
    private static readonly Guid MemberOid = Guid.NewGuid();
    private static readonly Guid NoAccountOid = Guid.NewGuid();

    private readonly RecordingAdminService _service = new();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        var builder = WebApplication.CreateBuilder();
        builder.WebHost.UseUrls("http://127.0.0.1:0");
        builder.Logging.ClearProviders();
        builder.Services.AddAuthentication(TestScheme.Name).AddScheme<AuthenticationSchemeOptions, TestScheme>(TestScheme.Name, _ => { });
        builder.Services.AddAuthorizationBuilder().AddJuplePolicies(Scope);
        // The scope check's handler, which the real API gets from AddMicrosoftIdentityWebApi.
        Microsoft.Identity.Web.RequiredScopeExtensions.AddRequiredScopeAuthorization(builder.Services);
        builder.Services.AddHttpContextAccessor();
        builder.Services.AddScoped<Microsoft.AspNetCore.Authorization.IAuthorizationHandler, ActiveAdminAuthorizationHandler>();
        builder.Services.AddSingleton<ICurrentJupleUserAccessor>(new FakeUsers(new Dictionary<Guid, long>
        {
            [AdminOid] = 1,
            [InactiveAdminOid] = 2,
            [MemberOid] = 3,
        }));
        // The same rule as the real store: only ACTIVE grants authorize.
        builder.Services.AddSingleton<IAdminAccessStore>(new FakeGrants([new(1, AdminRole.Owner, Active: true), new(2, AdminRole.Admin, Active: false)]));
        builder.Services.AddSingleton<IAdminService>(_service);
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton(Options.Create(new MobileVersionPolicyOptions()));
        builder.Services.AddControllers().AddApplicationPart(typeof(AdminController).Assembly);

        _app = builder.Build();
        _app.UseAuthentication();
        _app.UseAuthorization();
        _app.MapControllers();
        await _app.StartAsync();
        _client = new HttpClient { BaseAddress = new Uri(_app.Urls.First()) };
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    public static TheoryData<string, string> AdminRoutes => new()
    {
        { "GET", "/api/v1/admin/me" },
        { "GET", "/api/v1/admin/dashboard/summary" },
        { "GET", "/api/v1/admin/users" },
        { "GET", "/api/v1/admin/operations/app-version" },
        { "GET", "/api/v1/admin/operations/system" },
        { "GET", "/api/v1/admin/support/inquiries" },
        { "GET", "/api/v1/admin/support/inquiries/7" },
        { "PUT", "/api/v1/admin/support/inquiries/7/status" },
        { "PUT", "/api/v1/admin/support/inquiries/7/answer" },
    };

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task WithoutAToken_EveryAdminRouteIs401(string method, string path)
    {
        var response = await SendAsync(method, path, identity: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Equal(0, _service.Calls);
    }

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task AnOrdinarySignedInUser_Is403_AndNoAdminCodeRuns(string method, string path)
    {
        var response = await SendAsync(method, path, MemberOid);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, _service.Calls);
    }

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task AnInactiveAdmin_Is403(string method, string path)
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(method, path, InactiveAdminOid)).StatusCode);
        Assert.Equal(0, _service.Calls);
    }

    [Fact]
    public async Task AnEntraIdentityWithoutAJupleAccount_Is403()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", "/api/v1/admin/me", NoAccountOid)).StatusCode);
    }

    [Fact]
    public async Task ATokenWithoutTheApiScope_Is403_EvenForAnAdmin()
    {
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", "/api/v1/admin/me", AdminOid, scope: "openid")).StatusCode);
    }

    [Theory]
    [MemberData(nameof(AdminRoutes))]
    public async Task AnActiveAdmin_Is200(string method, string path)
    {
        var response = await SendAsync(method, path, AdminOid);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Me_ReportsTheCallersOwnGrant_FromTheDatabaseNotTheRequest()
    {
        var me = await (await SendAsync("GET", "/api/v1/admin/me", AdminOid)).Content.ReadFromJsonAsync<AdminController.AdminMeResponse>();

        Assert.Equal(new AdminController.AdminMeResponse(1, "Owner"), me);
    }

    [Fact]
    public async Task ClientSentRoleHeadersClaimsAndBodyFields_GrantNothing()
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/v1/admin/support/inquiries/7/answer")
        {
            Content = JsonContent.Create(new { answer = "hi", role = "Owner", isAdmin = true, adminUserId = 1 }),
        };
        request.Headers.Add(TestScheme.Header, $"{Tenant},{MemberOid},{Scope}");
        request.Headers.Add("X-Juple-Admin", "true");
        request.Headers.Add("X-Admin-Role", "Owner");
        request.Headers.Add(TestScheme.ExtraRoleHeader, "Admin"); // even an extra "roles" claim in the token is ignored

        var response = await _client.SendAsync(request);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, _service.Calls);
    }

    [Fact]
    public async Task TheActingAdmin_IsAlwaysTheAuthorizedCaller_NeverABodyValue()
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/v1/admin/support/inquiries/7/status")
        {
            Content = JsonContent.Create(new { status = "InProgress", adminUserId = 999 }),
        };
        request.Headers.Add(TestScheme.Header, $"{Tenant},{AdminOid},{Scope}");

        Assert.Equal(HttpStatusCode.OK, (await _client.SendAsync(request)).StatusCode);
        Assert.Equal(1, _service.LastAdminUserId);
    }

    [Fact]
    public async Task AnotherPersonsTokenCannotBorrowTheAdminsGrant()
    {
        // Same tenant, different object id: the grant follows the internal user the token maps to, not the request.
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", "/api/v1/admin/me", MemberOid)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await SendAsync("GET", "/api/v1/admin/me", AdminOid)).StatusCode);
    }

    [Fact]
    public void EveryAdminRoute_IsBehindTheAdminPolicy_AndNoOtherControllerUsesIt()
    {
        var controllers = typeof(AdminController).Assembly.GetTypes()
            .Where(type => typeof(ControllerBase).IsAssignableFrom(type) && !type.IsAbstract)
            .ToArray();
        foreach (var controller in controllers)
        {
            var route = controller.GetCustomAttributes(typeof(RouteAttribute), inherit: true).Cast<RouteAttribute>().SingleOrDefault()?.Template ?? string.Empty;
            var policy = controller.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AuthorizeAttribute), inherit: true)
                .Cast<Microsoft.AspNetCore.Authorization.AuthorizeAttribute>()
                .SingleOrDefault()?.Policy;
            if (route.StartsWith("api/v1/admin", StringComparison.Ordinal))
            {
                Assert.True(policy == AuthorizationPolicies.JupleAdmin, $"{controller.Name} must use the Admin policy");
                Assert.DoesNotContain(controller.GetMethods(), method => method.GetCustomAttributes(typeof(Microsoft.AspNetCore.Authorization.AllowAnonymousAttribute), true).Length > 0);
            }
            else
            {
                Assert.NotEqual(AuthorizationPolicies.JupleAdmin, policy);
            }
        }

        Assert.Equal(["AdminController", "AdminSupportInquiriesController"], controllers.Where(type => type.Namespace == typeof(AdminController).Namespace).Select(type => type.Name).Order().ToArray());
    }

    private Task<HttpResponseMessage> SendAsync(string method, string path, Guid? identity, string scope = Scope)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "PUT")
        {
            request.Content = JsonContent.Create(path.EndsWith("/status", StringComparison.Ordinal) ? new { status = "InProgress" } : (object)new { answer = "Thanks" });
        }

        if (identity is { } oid)
        {
            request.Headers.Add(TestScheme.Header, $"{Tenant},{oid},{scope}");
        }

        return _client.SendAsync(request);
    }

    /// <summary>Stands in for JwtBearer: no header = no identity (401 challenge); otherwise the claims an Entra access token carries.</summary>
    private sealed class TestScheme(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        public const string Name = "Test";
        public const string Header = "X-Test-Identity";
        public const string ExtraRoleHeader = "X-Test-Extra-Role-Claim";

        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            if (!Request.Headers.TryGetValue(Header, out var value))
            {
                return Task.FromResult(AuthenticateResult.NoResult());
            }

            var parts = value.ToString().Split(',');
            var claims = new List<Claim>
            {
                new("http://schemas.microsoft.com/identity/claims/tenantid", parts[0]),
                new("http://schemas.microsoft.com/identity/claims/objectidentifier", parts[1]),
                new("http://schemas.microsoft.com/identity/claims/scope", parts[2]),
            };
            if (Request.Headers.TryGetValue(ExtraRoleHeader, out var role))
            {
                claims.Add(new Claim(ClaimTypes.Role, role.ToString()));
                claims.Add(new Claim("roles", role.ToString()));
            }

            return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(new ClaimsIdentity(claims, Name)), Name)));
        }
    }

    private sealed class FakeUsers(IReadOnlyDictionary<Guid, long> users) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            users.TryGetValue(externalIdentity.ObjectId, out var userId)
                ? Task.FromResult(new CurrentJupleUser(userId, "UTC", UserPlan.Free))
                : throw new CurrentJupleUserNotFoundException();
    }

    private sealed record Grant(long UserId, AdminRole Role, bool Active);

    private sealed class FakeGrants(IReadOnlyList<Grant> grants) : IAdminAccessStore
    {
        public Task<AdminAccess?> FindActiveAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(grants.Where(grant => grant.UserId == userId && grant.Active).Select(grant => new AdminAccess(grant.UserId, grant.Role)).SingleOrDefault());
    }

    private sealed class RecordingAdminService : IAdminService
    {
        private static readonly AdminInquiryDetail Detail = new(
            7, "InProgress", "Bug", null, "content", null, DateTimeOffset.UnixEpoch, null, null, new AdminInquiryDiagnostics(null, null, null, null, null, null), []);

        public int Calls { get; private set; }

        public long? LastAdminUserId { get; private set; }

        public Task<AdminDashboardSummary> GetDashboardSummaryAsync(DateTimeOffset? todayStartUtc, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AdminDashboardSummary(DateTimeOffset.UnixEpoch, DateTimeOffset.UnixEpoch, 0, 0, 0, 0, 0, 0, 0, 0));
        }

        public Task<AdminUserPage> ListUsersAsync(string? jupleId, long? cursor, int? limit, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AdminUserPage([], null));
        }

        public Task<AdminInquiryPage> ListInquiriesAsync(string? status, long? cursor, int? limit, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AdminInquiryPage([], null));
        }

        public Task<AdminInquiryDetail> GetInquiryAsync(long inquiryId, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(Detail);
        }

        public Task<AdminInquiryDetail> ChangeInquiryStatusAsync(long adminUserId, long inquiryId, string? status, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastAdminUserId = adminUserId;
            return Task.FromResult(Detail);
        }

        public Task<AdminInquiryDetail> AnswerInquiryAsync(long adminUserId, long inquiryId, string? answer, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastAdminUserId = adminUserId;
            return Task.FromResult(Detail);
        }
    }
}
