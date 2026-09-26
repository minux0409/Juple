using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class InstagramRedirectClassifierTests
{
    private static readonly Uri PostSource = new("https://www.instagram.com/p/ABC123xyz/?igsh=abc");

    [Theory]
    [InlineData("https://www.instagram.com/accounts/login/?next=%2Fp%2FABC123xyz%2F", InstagramRedirectPathCategory.AccountsLogin)]
    [InlineData("https://www.instagram.com/accounts/login", InstagramRedirectPathCategory.AccountsLogin)]
    [InlineData("https://www.instagram.com/challenge/?next=/p/ABC123xyz/", InstagramRedirectPathCategory.Challenge)]
    [InlineData("https://www.instagram.com/challenge/action/xyz/", InstagramRedirectPathCategory.Challenge)]
    [InlineData("https://www.instagram.com/consent/?flow=gdpr", InstagramRedirectPathCategory.Consent)]
    [InlineData("https://www.instagram.com/privacy/consent/", InstagramRedirectPathCategory.Consent)]
    [InlineData("https://www.instagram.com/", InstagramRedirectPathCategory.Root)]
    [InlineData("https://www.instagram.com/p/ABC123xyz/", InstagramRedirectPathCategory.SameContentPath)]
    [InlineData("https://www.instagram.com/p/ABC123xyz", InstagramRedirectPathCategory.SameContentPath)]
    [InlineData("https://www.instagram.com/some.user/p/ABC123xyz/", InstagramRedirectPathCategory.SameContentPath)]
    [InlineData("https://www.instagram.com/p/OTHER999/", InstagramRedirectPathCategory.OtherInstagramPath)]
    [InlineData("https://www.instagram.com/explore/", InstagramRedirectPathCategory.OtherInstagramPath)]
    [InlineData("https://www.instagram.com/accounts/edit/", InstagramRedirectPathCategory.OtherInstagramPath)]
    [InlineData("https://www.facebook.com/login/", InstagramRedirectPathCategory.ExternalHost)]
    [InlineData("https://notinstagram.com/accounts/login/", InstagramRedirectPathCategory.ExternalHost)]
    public void ClassifyPath_ReturnsTheExpectedCategory(string destination, InstagramRedirectPathCategory expected)
    {
        Assert.Equal(expected, InstagramRedirectClassifier.ClassifyPath(PostSource, new Uri(destination)));
    }

    [Fact]
    public void ClassifyPath_TreatsReelAndReelsAsTheSameContent()
    {
        var source = new Uri("https://instagram.com/reels/ABC123xyz/");

        Assert.Equal(
            InstagramRedirectPathCategory.SameContentPath,
            InstagramRedirectClassifier.ClassifyPath(source, new Uri("https://www.instagram.com/reel/ABC123xyz/")));
    }

    [Theory]
    [InlineData("https://www.instagram.com/p/x/", InstagramRedirectHostCategory.InstagramWww)]
    [InlineData("https://instagram.com/p/x/", InstagramRedirectHostCategory.InstagramApex)]
    [InlineData("https://m.instagram.com/p/x/", InstagramRedirectHostCategory.InstagramMobile)]
    [InlineData("https://help.instagram.com/", InstagramRedirectHostCategory.InstagramOtherSubdomain)]
    [InlineData("https://www.facebook.com/", InstagramRedirectHostCategory.External)]
    public void ClassifyHost_ReturnsTheExpectedCategory(string destination, InstagramRedirectHostCategory expected)
    {
        Assert.Equal(expected, InstagramRedirectClassifier.ClassifyHost(new Uri(destination)));
    }
}
