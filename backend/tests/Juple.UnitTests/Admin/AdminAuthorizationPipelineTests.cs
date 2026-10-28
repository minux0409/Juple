using System.Net;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using Juple.Api.Authentication;
using Juple.Api.Configuration;
using Juple.Api.Controllers;
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
    private static readonly Guid NonOwnerAdminOid = Guid.NewGuid();
    private static readonly Guid InactiveAdminOid = Guid.NewGuid();
    private static readonly Guid MemberOid = Guid.NewGuid();
    private static readonly Guid NoAccountOid = Guid.NewGuid();

    private readonly RecordingAdminService _service = new();
    private readonly CannedAnalyticsStore _analyticsStore = new();
    private readonly Juple.UnitTests.Users.FakeMobileVersionPolicyStore _versionStore = new();
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
            [NonOwnerAdminOid] = 4,
        }));
        // The same rule as the real store: only ACTIVE grants authorize.
        builder.Services.AddSingleton<IAdminAccessStore>(new FakeGrants([new(1, AdminRole.Owner, Active: true), new(2, AdminRole.Admin, Active: false), new(4, AdminRole.Admin, Active: true)]));
        builder.Services.AddSingleton<IMobileVersionPolicyStore>(_versionStore);
        builder.Services.AddScoped<MobileVersionPolicyAdminService>();
        builder.Services.AddScoped<MobileVersionPolicySource>();
        builder.Services.AddSingleton<IAdminInsightsStore>(new CannedInsightsStore());
        builder.Services.AddScoped<AdminInsightsService>();
        builder.Services.AddSingleton(new Juple.Application.Translation.TranslationOptions());
        builder.Services.AddSingleton<Juple.Application.Translation.ITextTranslator, Juple.Application.Translation.DisabledTextTranslator>();
        builder.Services.AddSingleton<IAdminInquiryWorkflowStore>(new AcceptingWorkflowStore());
        builder.Services.AddScoped<AdminInquiryWorkflowService>();
        builder.Services.AddScoped<Juple.Application.Notices.NoticeTranslationService>();
        builder.Services.AddSingleton<IAdminService>(_service);
        // The real range validation in front of a canned store (the SQL side is covered by AdminAnalyticsIntegrationTests).
        builder.Services.AddSingleton<IAdminAnalyticsStore>(_analyticsStore);
        builder.Services.AddSingleton<IAdminAnalyticsService, AdminAnalyticsService>();
        builder.Services.AddSingleton(new Juple.Application.Billing.BillingOptions()); // the program off, as in Production
        builder.Services.AddSingleton(TimeProvider.System);
        builder.Services.AddSingleton(new AdminWorkspaceOptions());
        builder.Services.AddSingleton<IAdminWorkspaceStore>(new DisabledWorkspaceStore());
        builder.Services.AddSingleton<IAdminTelemetrySource>(new DisabledTelemetry());
        builder.Services.AddMemoryCache();
        builder.Services.AddSingleton<Juple.Application.Expenses.IAzureCostReportStore>(new Juple.Infrastructure.Expenses.AzureCostReportStore(null!));
        builder.Services.AddSingleton<Juple.Application.Expenses.IAzureCostDetailsSource>(new Juple.Infrastructure.Expenses.AzureExpenseSource(null!,null!));
        builder.Services.AddSingleton(new Juple.Application.Expenses.ExpenseOptions());
        builder.Services.AddSingleton(sp => new Juple.Application.Expenses.ExpenseService(null!, sp.GetRequiredService<IAdminAccessStore>(), sp.GetRequiredService<Juple.Application.Expenses.ExpenseOptions>(), TimeProvider.System));
        builder.Services.AddSingleton(sp => new Juple.Application.Expenses.ExpenseSyncService(null!, null!, sp.GetRequiredService<Juple.Application.Expenses.ExpenseService>(), sp.GetRequiredService<Juple.Application.Expenses.ExpenseOptions>(), TimeProvider.System));
        builder.Services.AddSingleton(sp => new Juple.Application.Expenses.ExpenseEvidenceService(sp.GetRequiredService<Juple.Application.Expenses.ExpenseService>(), null!, null!, null!, TimeProvider.System));
        // The Production shape: Android 31 / 24 with its Play URL, iOS without a policy.
        builder.Services.AddSingleton(Options.Create(new MobileVersionPolicyOptions
        {
            Android = new MobilePlatformVersionPolicy
            {
                LatestBuild = 31,
                MinimumSupportedBuild = 24,
                StoreUrl = "https://play.google.com/store/apps/details?id=com.juple.app",
            },
        }));
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
        { "PUT", "/api/v1/admin/operations/app-version/android" },
        { "GET", "/api/v1/admin/analytics/overview?range=30d" },
        { "GET", "/api/v1/admin/workspace/configuration" },
        { "GET", "/api/v1/admin/workspace/overview" },
        { "GET", "/api/v1/admin/workspace/operations" },
        { "GET", "/api/v1/admin/workspace/revenue" },
        { "POST", "/api/v1/admin/expenses/azure-report" },
        { "GET", "/api/v1/admin/users/5/link-stats?range=30d" },
        { "GET", "/api/v1/admin/operations/system" },
        { "GET", "/api/v1/admin/support/inquiries" },
        { "GET", "/api/v1/admin/support/inquiries/7" },
        { "PUT", "/api/v1/admin/support/inquiries/7/status" },
        { "PUT", "/api/v1/admin/support/inquiries/7/answer" },
        { "PUT", "/api/v1/admin/support/inquiries/7/answer-draft" },
        { "POST", "/api/v1/admin/support/inquiries/7/content-translation" },
        { "POST", "/api/v1/admin/support/inquiries/7/answer-translation" },
        { "GET", "/api/v1/admin/dashboard/kpis" },
        { "GET", "/api/v1/admin/dashboard/series?metric=links&range=30d" },
        { "GET", "/api/v1/admin/users/directory?search=K7&sort=linksDesc" },
        { "GET", "/api/v1/admin/users/5/link-history" },
        { "GET", "/api/v1/admin/costs/history?months=12" },
    };

    private sealed class DisabledTelemetry : IAdminTelemetrySource
    { public Task<WorkspaceTelemetry> ReadAsync(AdminDateRange p,CancellationToken ct) => throw new InvalidOperationException("Disabled feature must not query telemetry"); }
    private sealed class DisabledWorkspaceStore : IAdminWorkspaceStore
    {
        public Task<WorkspaceOverview> OverviewAsync(AdminDateRange p,DateTimeOffset now,CancellationToken ct) => throw new InvalidOperationException("Disabled feature must not query new schema");
        public Task<WorkspaceOperations> OperationsAsync(AdminDateRange p,CancellationToken ct) => throw new InvalidOperationException("Disabled feature must not query new schema");
        public Task<WorkspaceRevenue> RevenueAsync(bool billing,CancellationToken ct) => throw new InvalidOperationException("Disabled feature must not query new schema");
    }

    [Fact] public async Task Workspace_feature_off_keeps_configuration_available_but_blocks_schema_queries()
    {
        Assert.Equal(HttpStatusCode.OK,(await SendAsync("GET","/api/v1/admin/workspace/configuration",AdminOid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await SendAsync("GET","/api/v1/admin/workspace/overview",AdminOid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await SendAsync("GET","/api/v1/admin/workspace/operations",AdminOid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,(await SendAsync("GET","/api/v1/admin/workspace/revenue",AdminOid)).StatusCode);
    }

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

    [Theory]
    [InlineData("GET", "")]
    [InlineData("GET", "/configuration")]
    [InlineData("GET", "/summary")]
    [InlineData("GET", "/due?asOf=2026-10-20")]
    [InlineData("GET", "/7")]
    [InlineData("GET", "/export?format=xlsx")]
    [InlineData("GET", "/7/attachments/1")]
    [InlineData("GET", "/7/audit")]
    [InlineData("POST", "")]
    [InlineData("PUT", "/7")]
    [InlineData("DELETE", "/7")]
    [InlineData("POST", "/sync")]
    [InlineData("POST", "/schedules/project")]
    [InlineData("POST", "/7/attachments")]
    [InlineData("DELETE", "/7/attachments/1")]
    public async Task Expenses_never_reach_a_store_without_an_active_admin(string method, string suffix)
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync(method, "/api/v1/admin/expenses" + suffix, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(method, "/api/v1/admin/expenses" + suffix, MemberOid)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync(method, "/api/v1/admin/expenses" + suffix, InactiveAdminOid)).StatusCode);
    }

    [Theory]
    [InlineData("GET", "")][InlineData("GET", "/1")][InlineData("POST", "")][InlineData("PUT", "/1")][InlineData("DELETE", "/1?version=test")][InlineData("GET", "/translation-status")][InlineData("POST", "/translations")]
    public async Task Notices_require_an_active_server_admin_grant(string method, string suffix)
    {
        Assert.Equal(HttpStatusCode.Unauthorized,(await SendAsync(method,"/api/v1/admin/notices"+suffix,null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await SendAsync(method,"/api/v1/admin/notices"+suffix,MemberOid)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,(await SendAsync(method,"/api/v1/admin/notices"+suffix,InactiveAdminOid)).StatusCode);
    }

    [Fact]
    public async Task Expense_configuration_is_admin_only_and_does_not_enable_billing_or_the_ledger()
    {
        var response = await SendAsync("GET", "/api/v1/admin/expenses/configuration", AdminOid);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("no-store", response.Headers.CacheControl!.ToString());
        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"enabled\":false", json); Assert.Contains("\"monthlyUsdReferencePrice\":1.99", json);
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
        var disabled = path.StartsWith("/api/v1/admin/workspace/",StringComparison.Ordinal) && !path.EndsWith("/configuration",StringComparison.Ordinal)
            || path == "/api/v1/admin/expenses/azure-report" || path.StartsWith("/api/v1/admin/costs/", StringComparison.Ordinal);
        // No translation provider in this host: translating is refused as not configured, never faked.
        var unconfigured = path.EndsWith("/content-translation", StringComparison.Ordinal) || path.EndsWith("/answer-translation", StringComparison.Ordinal);
        if (unconfigured)
        {
            Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
            Assert.Contains("translationNotConfigured", await response.Content.ReadAsStringAsync());
            return;
        }

        Assert.Equal(disabled ? HttpStatusCode.NotFound : HttpStatusCode.OK, response.StatusCode);
    }

    /// <summary>
    /// The exact JSON the Admin Web reads: the first five fields per platform are what GET /api/v1/app-update/{platform} serves,
    /// followed by where they come from. Without a saved row that is the configured MobileVersionPolicy.
    /// </summary>
    [Fact]
    public async Task AppVersion_ServesTheConfiguredPolicy_InTheShapeTheAdminWebReads()
    {
        var json = await (await SendAsync("GET", "/api/v1/admin/operations/app-version", AdminOid)).Content.ReadAsStringAsync();

        Assert.Equal(
            """{"android":{"platform":"android","enabled":true,"latestBuild":31,"minimumSupportedBuild":24,"storeUrl":"https://play.google.com/store/apps/details?id=com.juple.app","source":"configuration","version":null,"updatedAtUtc":null,"updatedByAdminUserId":null,"configuredLatestBuild":31,"configuredMinimumSupportedBuild":24,"canEdit":true},"ios":{"platform":"ios","enabled":false,"latestBuild":0,"minimumSupportedBuild":0,"storeUrl":null,"source":"configuration","version":null,"updatedAtUtc":null,"updatedByAdminUserId":null,"configuredLatestBuild":0,"configuredMinimumSupportedBuild":0,"canEdit":true}}""",
            json);
    }

    private async Task<HttpResponseMessage> PutAppVersionAsync(string platform, object body, Guid identity)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/admin/operations/app-version/{platform}") { Content = JsonContent.Create(body) };
        request.Headers.Add(TestScheme.Header, $"{Tenant},{identity},{Scope}");
        return await _client.SendAsync(request);
    }

    private async Task<System.Text.Json.JsonElement> AppVersionAsync(Guid identity) =>
        await (await SendAsync("GET", "/api/v1/admin/operations/app-version", identity)).Content.ReadFromJsonAsync<System.Text.Json.JsonElement>();

    [Fact]
    public async Task TheOwner_RaisesAndroidLatest_KeepsTheMinimum_AndLeavesIosAlone_AndTheChangeIsAuditedAndServed()
    {
        var response = await PutAppVersionAsync("android", new { latestBuild = 34, minimumSupportedBuild = 24, version = (string?)null, adminUserId = 999 }, AdminOid);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var android = (await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("android");
        Assert.Equal(34, android.GetProperty("latestBuild").GetInt32());
        Assert.Equal(24, android.GetProperty("minimumSupportedBuild").GetInt32());
        Assert.Equal("database", android.GetProperty("source").GetString());
        Assert.Equal(1, android.GetProperty("updatedByAdminUserId").GetInt64());
        Assert.Null(_versionStore.Row("ios"));
        Assert.Equal((1L, "android", "latest 31->34; minimum 24->24; from configuration"), Assert.Single(_versionStore.Audit));

        // After a reload the page reads the saved values; the apps' anonymous check serves them too (same replica, cache dropped).
        var ios = (await AppVersionAsync(AdminOid)).GetProperty("ios");
        Assert.Equal("configuration", ios.GetProperty("source").GetString());
        Assert.Equal(0, ios.GetProperty("latestBuild").GetInt32());
        var served = await (await _client.GetAsync("/api/v1/app-update/android")).Content.ReadFromJsonAsync<AppUpdateController.AppUpdatePolicyResponse>();
        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("android", true, 34, 24, "https://play.google.com/store/apps/details?id=com.juple.app"), served);
    }

    [Fact]
    public async Task AnActiveAdminWhoIsNotTheOwner_CanRead_ButCannotChangeTheAppVersion()
    {
        Assert.False((await AppVersionAsync(NonOwnerAdminOid)).GetProperty("android").GetProperty("canEdit").GetBoolean());

        var response = await PutAppVersionAsync("android", new { latestBuild = 34, minimumSupportedBuild = 24, version = (string?)null }, NonOwnerAdminOid);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Contains("ownerRequired", await response.Content.ReadAsStringAsync());
        Assert.Null(_versionStore.Row("android"));
        Assert.Empty(_versionStore.Audit);
    }

    [Theory]
    [InlineData(0, 0, "latestBuild")]
    [InlineData(-34, 24, "latestBuild")]
    [InlineData(2_100_000_001, 24, "latestBuild")]
    [InlineData(34, 0, "minimumSupportedBuild")]
    [InlineData(34, 35, "minimumSupportedBuild")]
    [InlineData(30, 24, "confirmLatestDecrease")]
    [InlineData(34, 25, "confirmMinimumIncrease")]
    public async Task AnInvalidOrUnconfirmedChange_Is400_AndWritesNothing(int latest, int minimum, string field)
    {
        var response = await PutAppVersionAsync("android", new { latestBuild = latest, minimumSupportedBuild = minimum, version = (string?)null }, AdminOid);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Contains(field, await response.Content.ReadAsStringAsync());
        Assert.Null(_versionStore.Row("android"));
        Assert.Empty(_versionStore.Audit);
    }

    [Theory]
    [InlineData("""{"minimumSupportedBuild":24}""")]
    [InlineData("""{"latestBuild":34.5,"minimumSupportedBuild":24}""")]
    [InlineData("""{"latestBuild":"abc","minimumSupportedBuild":24}""")]
    public async Task ANonIntegerBuild_Is400(string json)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, "/api/v1/admin/operations/app-version/android")
        {
            Content = new StringContent(json, System.Text.Encoding.UTF8, "application/json"),
        };
        request.Headers.Add(TestScheme.Header, $"{Tenant},{AdminOid},{Scope}");

        Assert.Equal(HttpStatusCode.BadRequest, (await _client.SendAsync(request)).StatusCode);
        Assert.Null(_versionStore.Row("android"));
    }

    [Fact]
    public async Task ConfirmedChanges_RaiseTheMinimum_OrLowerTheLatest()
    {
        var raised = await PutAppVersionAsync("android", new { latestBuild = 34, minimumSupportedBuild = 30, version = (string?)null, confirmMinimumIncrease = true }, AdminOid);
        Assert.Equal(HttpStatusCode.OK, raised.StatusCode);
        var version = _versionStore.Row("android")!.Version;

        var lowered = await PutAppVersionAsync("android", new { latestBuild = 33, minimumSupportedBuild = 30, version, confirmLatestDecrease = true }, AdminOid);

        Assert.Equal(HttpStatusCode.OK, lowered.StatusCode);
        Assert.Equal((33, 30), (_versionStore.Row("android")!.LatestBuild, _versionStore.Row("android")!.MinimumSupportedBuild));
        Assert.Equal(2, _versionStore.Audit.Count);
    }

    [Fact]
    public async Task UnchangedValues_AreNotWrittenOrAudited()
    {
        var response = await PutAppVersionAsync("android", new { latestBuild = 31, minimumSupportedBuild = 24, version = (string?)null }, AdminOid);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Null(_versionStore.Row("android"));
        Assert.Empty(_versionStore.Audit);
    }

    [Fact]
    public async Task AStaleVersion_Is409_SoConcurrentEditsCannotOverwriteEachOther()
    {
        var first = await PutAppVersionAsync("android", new { latestBuild = 34, minimumSupportedBuild = 24, version = (string?)null }, AdminOid);
        Assert.Equal(HttpStatusCode.OK, first.StatusCode);

        // A second operator still holds the page they loaded before the first save (no row, version null).
        var second = await PutAppVersionAsync("android", new { latestBuild = 35, minimumSupportedBuild = 24, version = (string?)null }, AdminOid);
        var forged = await PutAppVersionAsync("android", new { latestBuild = 35, minimumSupportedBuild = 24, version = "not-the-version" }, AdminOid);

        Assert.Equal(HttpStatusCode.Conflict, second.StatusCode);
        Assert.Contains("appVersionChanged", await second.Content.ReadAsStringAsync());
        Assert.Equal(HttpStatusCode.Conflict, forged.StatusCode);
        Assert.Equal(34, _versionStore.Row("android")!.LatestBuild);
    }

    [Fact]
    public async Task AnUnknownPlatform_Is400()
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await PutAppVersionAsync("windows", new { latestBuild = 34, minimumSupportedBuild = 24 }, AdminOid)).StatusCode);
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

        Assert.Equal(["AdminAzureCostsController", "AdminController", "AdminCostsController", "AdminExpensesController", "AdminInsightsController", "AdminNoticesController", "AdminSupportInquiriesController", "AdminWorkspaceController"], controllers.Where(type => type.Namespace == typeof(AdminController).Namespace).Select(type => type.Name).Order().ToArray());
    }

    private Task<HttpResponseMessage> SendAsync(string method, string path, Guid? identity, string scope = Scope)
    {
        var request = new HttpRequestMessage(new HttpMethod(method), path);
        if (method == "POST" && path.EndsWith("/answer-translation", StringComparison.Ordinal))
            request.Content = JsonContent.Create(new { sourceKo = "확인했습니다", language = "en" });
        if (method == "POST" && path.EndsWith("/notices/translations", StringComparison.Ordinal))
            request.Content = JsonContent.Create(new { title = "제목", body = "본문" });
        if (method == "POST" && path.EndsWith("/azure-report",StringComparison.Ordinal))
            request.Content = JsonContent.Create(new { scope = "/subscriptions/00000000-0000-0000-0000-000000000001/resourceGroups/test", month = "2026-10-01" });
        if (method == "PUT")
        {
            request.Content = JsonContent.Create(
                path.Contains("/operations/app-version/", StringComparison.Ordinal) ? new { latestBuild = 31, minimumSupportedBuild = 24, version = (string?)null }
                : path.EndsWith("/answer-draft", StringComparison.Ordinal) ? new { sourceKo = "초안", translated = (string?)null, language = "ko" }
                : path.EndsWith("/status", StringComparison.Ordinal) ? new { status = "InProgress" } : (object)new { answer = "Thanks" });
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

    [Fact]
    public async Task UserLinkStats_401_403_400_404_200_AndNoLinkContentInTheAnswer()
    {
        const string path = "/api/v1/admin/users/5/link-stats";
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync("GET", path, identity: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", path, MemberOid)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", path, InactiveAdminOid)).StatusCode);
        Assert.Equal(0, _analyticsStore.UserStatsCalls);

        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync("GET", path + "?range=1y", AdminOid)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await SendAsync("GET", "/api/v1/admin/users/404/link-stats", AdminOid)).StatusCode);
        Assert.Equal(1, _analyticsStore.UserStatsCalls);

        var response = await SendAsync("GET", path + "?range=7d", AdminOid);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var json = await response.Content.ReadAsStringAsync();
        Assert.Contains("\"range\":\"7d\"", json, StringComparison.Ordinal);
        Assert.Contains("\"liveLinks\":7", json, StringComparison.Ordinal);
        Assert.Contains("\"saved90Days\":4", json, StringComparison.Ordinal);
        foreach (var forbidden in new[] { "url", "title", "memo", "image", "preview" })
        {
            Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
        }
    }

    [Fact]
    public async Task Analytics_RunsOnlyForAnAdmin_AndAnUnknownRangeIs400()
    {
        Assert.Equal(HttpStatusCode.Unauthorized, (await SendAsync("GET", "/api/v1/admin/analytics/overview", identity: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await SendAsync("GET", "/api/v1/admin/analytics/overview", MemberOid)).StatusCode);
        Assert.Equal(0, _analyticsStore.Calls);

        Assert.Equal(HttpStatusCode.BadRequest, (await SendAsync("GET", "/api/v1/admin/analytics/overview?range=1y", AdminOid)).StatusCode);
        Assert.Equal(0, _analyticsStore.Calls);

        var json = await (await SendAsync("GET", "/api/v1/admin/analytics/overview?range=7d", AdminOid)).Content.ReadAsStringAsync();
        Assert.Equal(1, _analyticsStore.Calls);
        Assert.Contains("\"range\":\"7d\"", json, StringComparison.Ordinal);
        Assert.Contains("\"activityTrackingSince\":\"2026-10-19\"", json, StringComparison.Ordinal);
        Assert.Contains("\"countries\":{\"available\":false}", json, StringComparison.Ordinal);
        // Round 6 additions travel in the same answer; with the billing program off there are no trial / paid groups.
        Assert.Contains("\"membership\":{\"billingProgramEnabled\":false,\"programStartAtUtc\":null,\"totalUsers\":20,\"newToday\":0,\"signedUpWithin30Days\":3,\"signedUpOver30Days\":17,\"groups\":null}", json, StringComparison.Ordinal);
        Assert.Contains("\"topHolders\":[{\"jupleId\":\"QZAMQBQK\",\"liveLinks\":40}]", json, StringComparison.Ordinal);
    }

    private sealed class CannedAnalyticsStore : IAdminAnalyticsStore
    {
        public int Calls { get; private set; }

        public Task<AdminAnalyticsOverview> GetOverviewAsync(string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult(new AdminAnalyticsOverview(
                range,
                todayUtc.AddDays(-(days - 1)),
                todayUtc,
                nowUtc,
                new DateOnly(2026, 10, 19),
                new AdminAnalyticsUsers(20, 0, 1, 3, 1, 1, 1, 1),
                new AdminAnalyticsLinks(123, 0, 2, 9, 2, 1),
                new AdminAnalyticsCollections(83, 5, 1, 4, 1),
                new AdminAnalyticsPlatforms(1, [new AdminAnalyticsPlatform("Android", 1)]),
                new AdminAnalyticsCountries(false),
                []));
        }

        public Task<AdminMembership> GetMembershipAsync(DateTimeOffset nowUtc, DateOnly todayUtc, DateTimeOffset? programStartAtUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminMembership(programStartAtUtc is not null, programStartAtUtc, 20, 0, 3, 17, null));

        public Task<AdminLinkHoldings> GetLinkHoldingsAsync(int topHolders, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminLinkHoldings(123, 9, 20, 40, 1, [new AdminLinkBucket(0, 0, 11)], [new AdminLinkHolder("QZAMQBQK", 40)]));

        public int UserStatsCalls { get; private set; }

        public Task<AdminUserLinkStats?> GetUserLinkStatsAsync(long userId, string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            UserStatsCalls++;
            return Task.FromResult<AdminUserLinkStats?>(userId == 404
                ? null
                : new AdminUserLinkStats(userId, "QZAMQBQK", nowUtc, range, todayUtc.AddDays(-(days - 1)), todayUtc, nowUtc, 7, 1, 2, 3, 4, 2, [new AdminUserLinkDay(todayUtc, 2)]));
        }
    }

    private sealed class CannedInsightsStore : IAdminInsightsStore
    {
        public Task<AdminDashboardKpis> KpisAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminDashboardKpis(3, 12, 1, AdminDateRange.SeoulDate(nowUtc), "Asia/Seoul", nowUtc));

        public Task<AdminMetricSeries> SeriesAsync(string metric, AdminDateRange period, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminMetricSeries(metric, period.From, period.Through, "Asia/Seoul", nowUtc, [new AdminMetricPoint(period.Through, 12)], "definition"));

        public Task<AdminUserDirectoryPage> UsersAsync(AdminUserDirectoryQuery query, CancellationToken cancellationToken = default) =>
            Task.FromResult(new AdminUserDirectoryPage([], query.Page, query.PageSize, 0, []));

        public Task<AdminUserLinkHistory?> UserLinkHistoryAsync(long userId, bool monthly, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<AdminUserLinkHistory?>(new AdminUserLinkHistory(userId, "K7MP4Q8N", null, nowUtc, AdminDateRange.SeoulDate(nowUtc), AdminDateRange.SeoulDate(nowUtc), "day", 0, 0, [], "Asia/Seoul", nowUtc));
    }

    private sealed class AcceptingWorkflowStore : IAdminInquiryWorkflowStore
    {
        public Task<string?> GetContentAsync(long inquiryId, CancellationToken cancellationToken = default) => Task.FromResult<string?>("content");

        public Task<bool> RecordContentTranslationAsync(long inquiryId, string? detectedLanguage, string translationKo, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<bool> SaveDraftAsync(long inquiryId, string? sourceKo, string? translated, string? language, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<AdminInquiryAnswerOutcome> SendAnswerAsync(long inquiryId, string delivered, string sourceKo, string language, DateTimeOffset? expectedUpdatedAtUtc, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(AdminInquiryAnswerOutcome.Answered);
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
