using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class InstagramImageUrlPolicyTests
{
    [Theory]
    [InlineData("https://scontent.cdninstagram.com/v/t51/real.jpg?stp=x&oh=y")]
    [InlineData("https://scontent-ssn1-1.cdninstagram.com/v/t51/real.jpg")]
    [InlineData("https://instagram.ficn2-1.fna.fbcdn.net/v/t51/real.jpg")]
    [InlineData("https://scontent-icn2-1.xx.fbcdn.net/v/t51/real.jpg")]
    public void IsAllowedPostImage_AcceptsInstagramAndMetaMediaCdns(string url)
    {
        Assert.True(InstagramImageUrlPolicy.IsAllowedPostImage(url));
    }

    [Theory]
    [InlineData("https://static.cdninstagram.com/rsrc.php/v4/generic-icon.png")] // generic UI asset
    [InlineData("http://scontent.cdninstagram.com/v/real.jpg")] // not HTTPS
    [InlineData("https://user:pass@scontent.cdninstagram.com/v/real.jpg")] // userinfo
    [InlineData("https://scontent.cdninstagram.com:8443/v/real.jpg")] // non-default port
    [InlineData("https://evil.example.com/v/real.jpg")]
    [InlineData("https://cdninstagram.com.evil.example/v/real.jpg")]
    [InlineData("https://fbcdn.net.evil.example/v/real.jpg")]
    [InlineData("javascript:alert(1)")]
    [InlineData("/relative/path.jpg")]
    public void IsAllowedPostImage_RejectsEverythingElse(string url)
    {
        Assert.False(InstagramImageUrlPolicy.IsAllowedPostImage(url));
    }
}
