using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace Juple.UnitTests.Users;

/// <summary>The sign-in-free update policy: the same single source as the bootstrap response, never more than build numbers and a public store URL.</summary>
public sealed class AppUpdateControllerTests
{
    private static AppUpdateController Controller(MobileVersionPolicyOptions options) =>
        new(Options.Create(options)) { ControllerContext = new ControllerContext { HttpContext = new DefaultHttpContext() } };

    private static MobileVersionPolicyOptions Configured() => new()
    {
        Android = new MobilePlatformVersionPolicy { LatestBuild = 24, MinimumSupportedBuild = 23, StoreUrl = " https://play.google.com/store/apps/details?id=com.juple.app " },
        Ios = new MobilePlatformVersionPolicy(),
    };

    [Fact]
    public void TheEndpoint_IsReadableWithoutSigningIn()
    {
        Assert.NotNull(typeof(AppUpdateController).GetCustomAttributes(typeof(AllowAnonymousAttribute), inherit: true).SingleOrDefault());
    }

    [Fact]
    public void Android_ReturnsTheConfiguredBuildsAndTrimmedStoreUrl_WithShortCaching()
    {
        var controller = Controller(Configured());

        var result = Assert.IsType<OkObjectResult>(controller.Get("android"));
        var body = Assert.IsType<AppUpdateController.AppUpdatePolicyResponse>(result.Value);

        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("android", true, 24, 23, "https://play.google.com/store/apps/details?id=com.juple.app"), body);
        Assert.Equal("public, max-age=60", controller.Response.Headers.CacheControl.ToString());
    }

    [Fact]
    public void APlatformWithoutAPolicy_IsDisabledWithNoNumbersAndNoUrl()
    {
        var result = Assert.IsType<OkObjectResult>(Controller(Configured()).Get("ios"));
        var body = Assert.IsType<AppUpdateController.AppUpdatePolicyResponse>(result.Value);

        Assert.Equal(new AppUpdateController.AppUpdatePolicyResponse("ios", false, 0, 0, null), body);
    }

    [Theory]
    [InlineData("windows")]
    [InlineData("")]
    [InlineData("android/../x")]
    public void AnUnknownPlatform_IsNotFound(string platform)
    {
        Assert.IsType<NotFoundResult>(Controller(Configured()).Get(platform));
    }

    [Fact]
    public void ThePlatformNameIsCaseInsensitive()
    {
        Assert.IsType<OkObjectResult>(Controller(Configured()).Get("Android"));
    }

    [Fact]
    public void AMinimumOnlyPolicy_IsEnabled_AndKeepsItsMinimum()
    {
        var options = new MobileVersionPolicyOptions { Android = new MobilePlatformVersionPolicy { LatestBuild = 30, MinimumSupportedBuild = 30 } };
        var body = Assert.IsType<AppUpdateController.AppUpdatePolicyResponse>(Assert.IsType<OkObjectResult>(Controller(options).Get("android")).Value);

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
}
