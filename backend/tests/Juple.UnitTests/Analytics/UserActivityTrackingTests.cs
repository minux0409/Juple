using System.Security.Claims;
using Juple.Api.Analytics;
using Juple.Application.Admin;
using Juple.Application.Analytics;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Analytics;
using Juple.Domain.Users;
using Juple.Infrastructure.Analytics;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.Analytics;

/// <summary>Daily activity: which requests count, how the platform is told, and that the database is touched at most hourly.</summary>
public sealed class UserActivityTrackingTests
{
    private static readonly Guid Tenant = Guid.NewGuid();
    private static readonly Guid Oid = Guid.NewGuid();

    [Theory]
    [InlineData("android", null, ClientPlatform.Android)]
    [InlineData("iOS", null, ClientPlatform.Ios)]
    [InlineData(" web ", null, ClientPlatform.Web)]
    [InlineData(null, "okhttp/4.12.0", ClientPlatform.Android)]
    [InlineData(null, "Juple/31 CFNetwork/1568.100.1 Darwin/24.0.0", ClientPlatform.Ios)]
    [InlineData(null, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/141.0 Safari/537.36", ClientPlatform.Web)]
    [InlineData(null, "curl/8.9.1", ClientPlatform.Unknown)]
    [InlineData(null, null, ClientPlatform.Unknown)]
    [InlineData("windows-phone", "okhttp/4.12.0", ClientPlatform.Android)]
    [InlineData("'; DROP TABLE x;--", null, ClientPlatform.Unknown)]
    public void Platform_IsTheClosedHeaderValue_OrTheHttpStack_NeverAFreeString(string? header, string? userAgent, ClientPlatform expected)
    {
        Assert.Equal(expected, ClientPlatformDetector.Detect(header, userAgent));
    }

    [Theory]
    [InlineData("31", "31")]
    [InlineData(" 1.2.3-rc_1 ", "1.2.3-rc_1")]
    [InlineData("", null)]
    [InlineData("31; DROP", null)]
    [InlineData("<script>", null)]
    public void AppBuild_IsBounded(string? value, string? expected)
    {
        Assert.Equal(expected, ClientPlatformDetector.NormalizeAppBuild(value));
        Assert.Null(ClientPlatformDetector.NormalizeAppBuild(new string('9', 33)));
    }

    [Fact]
    public void ARequestCounts_OnlyWhenSignedIn_OnTheProductApi_AndTheIdentityComesFromTheToken()
    {
        var context = SignedIn("/api/v1/items");
        context.Request.Headers["X-Juple-Platform"] = "android";
        context.Request.Headers["X-Juple-App-Build"] = "31";
        // Headers that try to name somebody else are not read at all.
        context.Request.Headers["X-Juple-User"] = "1";
        context.Request.Headers["X-Juple-Object-Id"] = Guid.NewGuid().ToString();

        Assert.True(UserActivityRequest.TryClassify(context, out var identity, out var platform, out var build));
        Assert.Equal(new ExternalIdentityPrincipal(Tenant, Oid), identity);
        Assert.Equal(ClientPlatform.Android, platform);
        Assert.Equal("31", build);
    }

    [Theory]
    [InlineData("/api/v1/admin/me")]
    [InlineData("/api/v1/admin/analytics/overview")]
    [InlineData("/health")]
    [InlineData("/")]
    public void TheAdminWeb_AndNonApiPaths_AreNotProductActivity(string path)
    {
        Assert.False(UserActivityRequest.TryClassify(SignedIn(path), out _, out _, out _));
    }

    [Fact]
    public void Anonymous_401_OrATokenWithoutIds_IsNotActivity()
    {
        var anonymous = new DefaultHttpContext();
        anonymous.Request.Path = "/api/v1/items";
        Assert.False(UserActivityRequest.TryClassify(anonymous, out _, out _, out _));

        var rejected = SignedIn("/api/v1/items");
        rejected.Response.StatusCode = StatusCodes.Status401Unauthorized;
        Assert.False(UserActivityRequest.TryClassify(rejected, out _, out _, out _));

        var noIds = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([new Claim("name", "x")], "Bearer")) };
        noIds.Request.Path = "/api/v1/items";
        Assert.False(UserActivityRequest.TryClassify(noIds, out _, out _, out _));
    }

    [Fact]
    public void TheWeb_RecordsNoBuild_EvenIfOneIsSent()
    {
        var context = SignedIn("/api/v1/items");
        context.Request.Headers.UserAgent = "Mozilla/5.0 Chrome";
        context.Request.Headers["X-Juple-App-Build"] = "31";

        Assert.True(UserActivityRequest.TryClassify(context, out _, out var platform, out var build));
        Assert.Equal(ClientPlatform.Web, platform);
        Assert.Null(build);
    }

    [Fact]
    public void Pump_WritesOncePerPersonPlatformAndDay_RefreshesHourly_AndAgainTheNextDay()
    {
        var clock = new Clock(new DateTimeOffset(2026, 10, 19, 10, 0, 0, TimeSpan.Zero));
        var pump = new UserActivityPump(new ServiceCollection().BuildServiceProvider().GetRequiredService<IServiceScopeFactory>(), clock, NullLogger<UserActivityPump>.Instance);
        var person = new ExternalIdentityPrincipal(Tenant, Oid);

        Assert.True(pump.Observe(person, ClientPlatform.Android, "31"));
        Assert.False(pump.Observe(person, ClientPlatform.Android, "31")); // the same minute: nothing
        Assert.True(pump.Observe(person, ClientPlatform.Web, null)); // another platform is its own row
        clock.Now = clock.Now.AddMinutes(59);
        Assert.False(pump.Observe(person, ClientPlatform.Android, "31"));
        clock.Now = clock.Now.AddMinutes(2);
        Assert.True(pump.Observe(person, ClientPlatform.Android, "31")); // hourly LastSeen refresh
        clock.Now = new DateTimeOffset(2026, 10, 20, 0, 0, 1, TimeSpan.Zero);
        Assert.True(pump.Observe(person, ClientPlatform.Android, "31")); // a new UTC day
    }

    [Fact]
    public async Task Pump_ResolvesTheUserFromTheIdentity_AndForgetsAFailedWriteSoALaterRequestRetries()
    {
        var store = new RecordingStore();
        var services = new ServiceCollection()
            .AddSingleton<ICurrentJupleUserAccessor>(new FixedUser(42))
            .AddSingleton<IUserActivityStore>(store)
            .BuildServiceProvider();
        var clock = new Clock(new DateTimeOffset(2026, 10, 19, 10, 0, 0, TimeSpan.Zero));
        var pump = new UserActivityPump(services.GetRequiredService<IServiceScopeFactory>(), clock, NullLogger<UserActivityPump>.Instance);
        var person = new ExternalIdentityPrincipal(Tenant, Oid);
        var signal = new UserActivityPump.UserActivitySignal(person, ClientPlatform.Ios, "120", new DateOnly(2026, 10, 19), clock.Now);

        Assert.True(pump.Observe(person, ClientPlatform.Ios, "120"));
        await pump.RecordAsync(signal, CancellationToken.None);
        Assert.Equal([(42L, new DateOnly(2026, 10, 19), ClientPlatform.Ios, (string?)"120")], store.Writes);
        Assert.False(pump.Observe(person, ClientPlatform.Ios, "120"));

        store.Fail = true;
        await pump.RecordAsync(signal, CancellationToken.None); // never throws
        Assert.True(pump.Observe(person, ClientPlatform.Ios, "120")); // forgotten: the next request records again
    }

    [Fact]
    public async Task Pump_RecordsNothing_ForASignInWithoutAJupleAccount()
    {
        var store = new RecordingStore();
        var services = new ServiceCollection()
            .AddSingleton<ICurrentJupleUserAccessor>(new FixedUser(null))
            .AddSingleton<IUserActivityStore>(store)
            .BuildServiceProvider();
        var pump = new UserActivityPump(services.GetRequiredService<IServiceScopeFactory>(), TimeProvider.System, NullLogger<UserActivityPump>.Instance);

        await pump.RecordAsync(new(new ExternalIdentityPrincipal(Tenant, Oid), ClientPlatform.Web, null, new DateOnly(2026, 10, 19), DateTimeOffset.UtcNow), CancellationToken.None);

        Assert.Empty(store.Writes);
    }

    [Theory]
    [InlineData(null, "30d", 30)]
    [InlineData("7d", "7d", 7)]
    [InlineData("30d", "30d", 30)]
    [InlineData("90d", "90d", 90)]
    public async Task Analytics_Ranges_Are7_30_90UtcDaysEndingToday(string? requested, string expectedRange, int expectedDays)
    {
        var store = new CapturingAnalyticsStore();
        var clock = new Clock(new DateTimeOffset(2026, 10, 19, 23, 59, 0, TimeSpan.FromHours(9)));

        await new AdminAnalyticsService(store, clock, new Juple.Application.Billing.BillingOptions()).GetOverviewAsync(requested);

        Assert.Equal((expectedRange, expectedDays, new DateOnly(2026, 10, 19)), (store.Range, store.Days, store.Today));
    }

    [Theory]
    [InlineData("1y")]
    [InlineData("30")]
    [InlineData("30D")]
    [InlineData("-7d")]
    public async Task Analytics_AnyOtherRange_IsRefused(string range)
    {
        var exception = await Assert.ThrowsAsync<InvalidAdminRequestException>(() => new AdminAnalyticsService(new CapturingAnalyticsStore(), TimeProvider.System, new Juple.Application.Billing.BillingOptions()).GetOverviewAsync(range));
        Assert.Equal("range", exception.Field);
    }

    private static DefaultHttpContext SignedIn(string path)
    {
        var claims = new ClaimsIdentity(
            [new Claim("http://schemas.microsoft.com/identity/claims/tenantid", Tenant.ToString()), new Claim("http://schemas.microsoft.com/identity/claims/objectidentifier", Oid.ToString())],
            "Bearer");
        var context = new DefaultHttpContext { User = new ClaimsPrincipal(claims) };
        context.Request.Path = path;
        context.Response.StatusCode = StatusCodes.Status200OK;
        return context;
    }

    private sealed class Clock(DateTimeOffset now) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = now;

        public override DateTimeOffset GetUtcNow() => Now.ToUniversalTime();
    }

    private sealed class FixedUser(long? userId) : ICurrentJupleUserAccessor
    {
        public Task<CurrentJupleUser> GetRequiredAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
            userId is { } id ? Task.FromResult(new CurrentJupleUser(id, "UTC", UserPlan.Free)) : throw new CurrentJupleUserNotFoundException();
    }

    private sealed class RecordingStore : IUserActivityStore
    {
        public List<(long, DateOnly, ClientPlatform, string?)> Writes { get; } = [];

        public bool Fail { get; set; }

        public Task RecordAsync(long userId, DateOnly activityDateUtc, ClientPlatform platform, string? appBuild, DateTimeOffset seenAtUtc, CancellationToken cancellationToken = default)
        {
            if (Fail)
            {
                throw new InvalidOperationException("database unavailable");
            }

            Writes.Add((userId, activityDateUtc, platform, appBuild));
            return Task.CompletedTask;
        }
    }

    private sealed class CapturingAnalyticsStore : IAdminAnalyticsStore
    {
        public string? Range { get; private set; }

        public int Days { get; private set; }

        public DateOnly Today { get; private set; }

        public DateTimeOffset? MembershipProgramStart { get; private set; } = DateTimeOffset.MinValue;

        public int TopHoldersAsked { get; private set; }

        public Task<AdminAnalyticsOverview> GetOverviewAsync(string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            (Range, Days, Today) = (range, days, todayUtc);
            return Task.FromResult(new AdminAnalyticsOverview(
                range,
                todayUtc,
                todayUtc,
                nowUtc,
                null,
                new AdminAnalyticsUsers(0, 0, 0, 0, 0, 0, 0, 0),
                new AdminAnalyticsLinks(0, 0, 0, 0, 0, 0),
                new AdminAnalyticsCollections(0, 0, 0, 0, 0),
                new AdminAnalyticsPlatforms(0, []),
                new AdminAnalyticsCountries(false),
                []));
        }

        public Task<AdminMembership> GetMembershipAsync(DateTimeOffset nowUtc, DateOnly todayUtc, DateTimeOffset? programStartAtUtc, CancellationToken cancellationToken = default)
        {
            MembershipProgramStart = programStartAtUtc;
            return Task.FromResult(new AdminMembership(programStartAtUtc is not null, programStartAtUtc, 0, 0, 0, 0, null));
        }

        public Task<AdminLinkHoldings> GetLinkHoldingsAsync(int topHolders, CancellationToken cancellationToken = default)
        {
            TopHoldersAsked = topHolders;
            return Task.FromResult(new AdminLinkHoldings(0, 0, 0, 0, 0, [], []));
        }

        public Task<AdminUserLinkStats?> GetUserLinkStatsAsync(long userId, string range, int days, DateOnly todayUtc, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            (Range, Days, Today) = (range, days, todayUtc);
            return Task.FromResult<AdminUserLinkStats?>(userId == 404 ? null : new AdminUserLinkStats(userId, "ABCD2345", nowUtc, range, todayUtc, todayUtc, nowUtc, 0, 0, 0, 0, 0, 0, []));
        }
    }

    [Fact]
    public async Task UserLinkStats_ValidatesTheRange_AndAMissingAccountIsNotFound()
    {
        var store = new CapturingAnalyticsStore();
        var service = new AdminAnalyticsService(store, TimeProvider.System, new Juple.Application.Billing.BillingOptions());
        await Assert.ThrowsAsync<InvalidAdminRequestException>(() => service.GetUserLinkStatsAsync(1, "1y"));
        Assert.Null(store.Range); // the bad range never reached the store
        await Assert.ThrowsAsync<AdminUserNotFoundException>(() => service.GetUserLinkStatsAsync(404, "7d"));

        var stats = await service.GetUserLinkStatsAsync(1, null);
        Assert.Equal("30d", stats.Range); // the overview's default
        Assert.Equal(30, store.Days);
    }

    [Fact]
    public async Task Membership_UsesTheBillingProgramsOwnSwitch_WithoutChangingIt()
    {
        var disabled = new CapturingAnalyticsStore();
        var overview = await new AdminAnalyticsService(disabled, TimeProvider.System, new Juple.Application.Billing.BillingOptions { ProgramEnabled = false, ProgramStartAtUtc = DateTimeOffset.UnixEpoch }).GetOverviewAsync("7d");
        Assert.Null(disabled.MembershipProgramStart); // not running: no trial / paid groups at all (even with a start date configured)
        Assert.False(overview.Membership!.BillingProgramEnabled);
        Assert.Equal(AdminAnalyticsService.TopHolders, disabled.TopHoldersAsked);
        Assert.NotNull(overview.LinkHoldings);

        var start = new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero);
        var enabledOptions = new Juple.Application.Billing.BillingOptions { ProgramEnabled = true, ProgramStartAtUtc = start };
        var enabled = new CapturingAnalyticsStore();
        await new AdminAnalyticsService(enabled, TimeProvider.System, enabledOptions).GetOverviewAsync("7d");
        Assert.Equal(start, enabled.MembershipProgramStart);
        Assert.True(enabledOptions.ProgramEnabled); // read, never written
    }
}
