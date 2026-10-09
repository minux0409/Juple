using Juple.Api.Configuration;
using Juple.Api.Controllers;
using Microsoft.Extensions.Configuration;

namespace Juple.UnitTests.Users;

public sealed class MobileVersionPolicyTests
{
    [Fact]
    public void ADefaultPolicyIsEmpty_NoPromptForAnyPlatform()
    {
        var options = new MobileVersionPolicyOptions();

        Assert.Null(options.Validate());
        var response = CurrentUserBootstrapController.MobileVersionPolicyResponse.From(options);
        Assert.Equal(new CurrentUserBootstrapController.MobilePlatformVersionPolicyResponse(0, 0, null), response.Android);
        Assert.Equal(new CurrentUserBootstrapController.MobilePlatformVersionPolicyResponse(0, 0, null), response.Ios);
    }

    [Fact]
    public void EachPlatformGetsItsOwnPolicy_AndTheShippedAppsettingsBindToNoPolicy()
    {
        var configuration = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["MobileVersionPolicy:Android:LatestBuild"] = "12",
            ["MobileVersionPolicy:Android:MinimumSupportedBuild"] = "9",
            ["MobileVersionPolicy:Ios:LatestBuild"] = "5",
            ["MobileVersionPolicy:Ios:MinimumSupportedBuild"] = "5",
            ["MobileVersionPolicy:Ios:StoreUrl"] = " https://apps.apple.com/app/id123 ",
        }).Build();

        var options = configuration.GetSection("MobileVersionPolicy").Get<MobileVersionPolicyOptions>()!;
        var response = CurrentUserBootstrapController.MobileVersionPolicyResponse.From(options);

        Assert.Null(options.Validate());
        Assert.Equal(new CurrentUserBootstrapController.MobilePlatformVersionPolicyResponse(12, 9, null), response.Android);
        Assert.Equal(new CurrentUserBootstrapController.MobilePlatformVersionPolicyResponse(5, 5, "https://apps.apple.com/app/id123"), response.Ios);

        var shipped = new ConfigurationBuilder().AddJsonFile(Path.Combine(AppContext.BaseDirectory, "appsettings.json"), optional: true).Build();
        var defaults = shipped.GetSection("MobileVersionPolicy").Get<MobileVersionPolicyOptions>() ?? new MobileVersionPolicyOptions();
        Assert.Equal(0, defaults.Android.LatestBuild);
        Assert.Equal(0, defaults.Ios.LatestBuild);
    }

    [Theory]
    [InlineData(-1, 0, null)]
    [InlineData(5, -1, null)]
    [InlineData(5, 6, null)]
    [InlineData(5, 5, "http://play.google.com/x")]
    [InlineData(5, 5, "not a url")]
    [InlineData(5, 5, "market://details?id=com.juple.app")]
    public void ABrokenPolicyIsRefused_SoItCanNeverPromptOrBlockByMistake(int latest, int minimum, string? storeUrl)
    {
        var options = new MobileVersionPolicyOptions { Android = new MobilePlatformVersionPolicy { LatestBuild = latest, MinimumSupportedBuild = minimum, StoreUrl = storeUrl } };

        Assert.NotNull(options.Validate());
    }

    [Fact]
    public void AMinimumEqualToLatestIsAllowed_AndABlankStoreUrlIsNotAnError()
    {
        var options = new MobileVersionPolicyOptions { Ios = new MobilePlatformVersionPolicy { LatestBuild = 7, MinimumSupportedBuild = 7, StoreUrl = "  " } };

        Assert.Null(options.Validate());
        Assert.Null(CurrentUserBootstrapController.MobileVersionPolicyResponse.From(options).Ios.StoreUrl);
    }
}
