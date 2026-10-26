using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Juple.Application.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Users;

/// <summary>The sign-in-free update policy: the same single source as the bootstrap response, never more than build numbers and a public store URL.</summary>
public sealed class AppUpdateControllerTests
{
    internal static MobileVersionPolicySource Source(MobileVersionPolicyOptions options, IMobileVersionPolicyStore? store = null) =>
        new(Options.Create(options), store ?? new FakeMobileVersionPolicyStore(), new MemoryCache(new MemoryCacheOptions { SizeLimit = 500 }), NullLogger<MobileVersionPolicySource>.Instance);

    private static AppUpdateController Controller(MobileVersionPolicyOptions options, IMobileVersionPolicyStore? store = null) =>
        new(Source(options, store)) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

    private static MobileVersionPolicyOptions Configured() => new()
    {
        Android = new MobilePlatformVersionPolicy { LatestBuild = 24, MinimumSupportedBuild = 23, StoreUrl = " https://play.google.com/store/apps/details?id=com.juple.app " },
        Ios = new MobilePlatformVersionPolicy(),
    };

    private static async Task<AppUpdateController.AppUpdatePolicyResponse> BodyAsync(AppUpdateController controller, string platform) =>
        Assert.IsType<AppUpdateController.AppUpdatePolicyResponse>(Assert.IsType<OkObjectResult>(await controller.Get(platform, CancellationToken.None)).Value);

    [Fact]
    public void TheEndpoint_IsReadableWithoutSigningIn()
    {
        Assert.NotNull(typeof(AppUpdateController).GetCustomAttributes(typeof(AllowAnonymousAttribute), inherit: true).SingleOrDefault());
    }

    [Fact]
    public async Task Android_ReturnsTheConfiguredBuildsAndTrimmedStoreUrl_WithShortCaching()
    {
        var controller = Controller(Configured());

        var body = await BodyAsync(controller, "android");

        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("android", true, 24, 23, "https://play.google.com/store/apps/details?id=com.juple.app"), body);
        Assert.Equal("public, max-age=60", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public async Task APlatformWithoutAPolicy_IsDisabledWithNoNumbersAndNoUrl()
    {
        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("ios", false, 0, 0, null), await BodyAsync(Controller(Configured()), "ios"));
    }

    [Theory]
    [InlineData("windows")]
    [InlineData("")]
    [InlineData("android/../x")]
    public async Task AnUnknownPlatform_IsNotFound(string platform)
    {
        Assert.IsType<NotFoundResult>(await Controller(Configured()).Get(platform, CancellationToken.None));
    }

    [Fact]
    public async Task ThePlatformNameIsCaseInsensitive()
    {
        Assert.IsType<OkObjectResult>(await Controller(Configured()).Get("Android", CancellationToken.None));
    }

    [Fact]
    public async Task AMinimumOnlyPolicy_IsEnabled_AndKeepsItsMinimum()
    {
        var options = new MobileVersionPolicyOptions { Android = new MobilePlatformVersionPolicy { LatestBuild = 30, MinimumSupportedBuild = 30 } };
        var body = await BodyAsync(Controller(options), "android");

        Assert.True(body.Enabled);
        Assert.Equal(30, body.MinimumSupportedBuild);
        Assert.Null(body.StoreUrl);
    }

    [Fact]
    public void TheResponse_CarriesNothingButTheFiveFields()
    {
        var properties = typeof(AppUpdateController.AppUpdatePolicyResponse).GetProperties().Select(property => property.Name).Order().ToArray();

        Assert.Equal(["Enabled", "LatestBuild", "MinimumSupportedBuild", "Platform", "StoreUrl"], properties);
    }

    [Fact]
    public async Task ASavedPlatform_ServesItsBuilds_KeepsTheConfiguredStoreUrl_AndLeavesTheOtherPlatformAlone()
    {
        var store = new FakeMobileVersionPolicyStore();
        store.Put("android", 34, 24);

        var controller = Controller(Configured(), store);

        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("android", true, 34, 24, "https://play.google.com/store/apps/details?id=com.juple.app"), await BodyAsync(controller, "android"));
        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("ios", false, 0, 0, null), await BodyAsync(controller, "ios"));
    }

    [Fact]
    public async Task AnUnreadableDatabase_ServesTheConfiguredPolicy_InsteadOfFailing()
    {
        var store = new FakeMobileVersionPolicyStore { Failure = new InvalidOperationException("database unavailable") };

        Assert.Equal(24, (await BodyAsync(Controller(Configured(), store), "android")).LatestBuild);
    }

    [Fact]
    public async Task AContradictorySavedRow_IsNoPolicy_NeverABlock()
    {
        var store = new FakeMobileVersionPolicyStore();
        store.Put("android", 20, 30);

        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("android", false, 0, 0, null), await BodyAsync(Controller(Configured(), store), "android"));
    }

    [Fact]
    public async Task ThePolicyIsCached_UntilThisReplicaInvalidatesIt()
    {
        var store = new FakeMobileVersionPolicyStore();
        var source = Source(Configured(), store);

        Assert.Equal(24, (await source.GetAsync()).Android.LatestBuild);
        store.Put("android", 34, 24);
        Assert.Equal(24, (await source.GetAsync()).Android.LatestBuild);

        source.Invalidate();
        Assert.Equal(34, (await source.GetAsync()).Android.LatestBuild);
        Assert.Equal(2, store.ListCalls);
    }

    [Fact]
    public async Task Merging_NeverChangesTheConfiguredOptions()
    {
        var configured = Configured();
        var store = new FakeMobileVersionPolicyStore();
        store.Put("android", 34, 24);

        await Source(configured, store).GetAsync();

        Assert.Equal(24, configured.Android.LatestBuild);
        Assert.Equal(23, configured.Android.MinimumSupportedBuild);
    }
}

/// <summary>An in-memory admin.MobileVersionPolicies with the store's insert/update concurrency rules.</summary>
internal sealed class FakeMobileVersionPolicyStore : IMobileVersionPolicyStore
{
    private readonly Dictionary<string, StoredMobileVersionPolicy> _rows = [];
    private int _version;

    public Exception? Failure { get; set; }

    public int ListCalls { get; private set; }

    public List<(long AdminUserId, string Platform, string Detail)> Audit { get; } = [];

    public StoredMobileVersionPolicy Put(string platform, int latest, int minimum)
    {
        var row = new StoredMobileVersionPolicy(platform, latest, minimum, null, DateTimeOffset.UnixEpoch, $"v{++_version}");
        _rows[platform] = row;
        return row;
    }

    public StoredMobileVersionPolicy? Row(string platform) => _rows.GetValueOrDefault(platform);

    public Task<IReadOnlyList<StoredMobileVersionPolicy>> ListAsync(CancellationToken cancellationToken = default)
    {
        ListCalls++;
        return Failure is null ? Task.FromResult<IReadOnlyList<StoredMobileVersionPolicy>>(_rows.Values.ToList()) : Task.FromException<IReadOnlyList<StoredMobileVersionPolicy>>(Failure);
    }

    public Task<StoredMobileVersionPolicy?> GetAsync(string platform, CancellationToken cancellationToken = default) => Task.FromResult(Row(platform));

    public Task<StoredMobileVersionPolicy> SaveAsync(long adminUserId, string platform, string? expectedVersion, MobileBuildPolicy builds, string auditDetail, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (Row(platform)?.Version != expectedVersion)
        {
            throw new MobileVersionPolicyConflictException();
        }

        var row = new StoredMobileVersionPolicy(platform, builds.LatestBuild, builds.MinimumSupportedBuild, adminUserId, nowUtc, $"v{++_version}");
        _rows[platform] = row;
        Audit.Add((adminUserId, platform, auditDetail));
        return Task.FromResult(row);
    }
}
