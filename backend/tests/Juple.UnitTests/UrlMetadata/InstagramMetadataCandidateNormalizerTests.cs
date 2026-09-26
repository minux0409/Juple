using Juple.Application.Items.InstagramMetadataCandidate;
using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class InstagramMetadataCandidateNormalizerTests
{
    private const string PostUrl = "https://www.instagram.com/p/ABC123xyz/?igsh=abc";
    private const string RealImage = "https://scontent.cdninstagram.com/v/t51/real.jpg";
    private static readonly InstagramMetadataCandidateNormalizer Normalizer = new();

    private static InstagramMetadataCandidateCommand Candidate(
        string? title = "낄낄엔터 on Instagram: \"오늘의 사진\"",
        string? image = RealImage,
        string? url = "https://www.instagram.com/kkikki_ent/p/ABC123xyz/",
        string? description = null) => new(title, image, url, description);

    [Fact]
    public void Normalize_MatchingPost_ReturnsHandleNormalizedTitleAndRealImage()
    {
        var result = Normalizer.Normalize(PostUrl, Candidate());

        Assert.NotNull(result);
        Assert.Equal("kkikki_ent on Instagram: \"오늘의 사진\"", result.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
    }

    [Theory]
    [InlineData("https://www.instagram.com/reel/ABC123xyz/")] // same media, reel path
    [InlineData("https://www.instagram.com/p/ABC123xyz")] // no trailing slash
    [InlineData("https://instagram.com/p/ABC123xyz/?utm_source=x")] // apex host + query
    public void Normalize_CanonicalEquivalentOgUrl_IsAccepted(string ogUrl)
    {
        Assert.NotNull(Normalizer.Normalize(PostUrl, Candidate(url: ogUrl)));
    }

    [Theory]
    [InlineData("https://www.instagram.com/p/OTHER999/")] // a different post
    [InlineData("https://www.instagram.com/abc123xyz/")] // not a content path
    [InlineData("http://www.instagram.com/p/ABC123xyz/")] // not HTTPS
    [InlineData("https://www.example.com/p/ABC123xyz/")] // not Instagram
    [InlineData("not a url")]
    public void Normalize_OgUrlForOtherContent_RejectsTheWholeCandidate(string ogUrl)
    {
        Assert.Null(Normalizer.Normalize(PostUrl, Candidate(url: ogUrl)));
    }

    [Theory]
    [InlineData("https://www.example.com/p/ABC123xyz/")] // not an Instagram Item
    [InlineData("https://www.instagram.com/some_user/")] // Instagram, but not a post/reel
    public void Normalize_ItemThatIsNotAnInstagramPost_IsRejected(string itemUrl)
    {
        Assert.Null(Normalizer.Normalize(itemUrl, Candidate()));
    }

    [Fact]
    public void Normalize_WithoutOgUrl_UsesTheDescriptionTemplateForTheHandle()
    {
        var result = Normalizer.Normalize(
            PostUrl,
            Candidate(url: null, description: "1,234 likes, 5 comments - real.handle on September 24, 2026: \"x\""));

        Assert.Equal("real.handle on Instagram: \"오늘의 사진\"", result!.Title);
    }

    [Theory]
    [InlineData("Instagram")]
    [InlineData("Log in • Instagram")]
    [InlineData("Login to Instagram")]
    [InlineData("   ")]
    public void Normalize_PlaceholderOrLoginTitle_IsDropped(string title)
    {
        var result = Normalizer.Normalize(PostUrl, Candidate(title: title));

        Assert.Null(result!.Title);
        Assert.Equal(RealImage, result.PreviewImageUrl);
    }

    [Theory]
    [InlineData("https://static.cdninstagram.com/rsrc.php/v4/generic-icon.png")]
    [InlineData("http://scontent.cdninstagram.com/v/real.jpg")]
    [InlineData("https://evil.example.com/real.jpg")]
    [InlineData("data:image/png;base64,AAAA")]
    public void Normalize_UnacceptableImage_IsDropped_TitleKept(string image)
    {
        var result = Normalizer.Normalize(PostUrl, Candidate(image: image));

        Assert.Null(result!.PreviewImageUrl);
        Assert.NotNull(result.Title);
    }

    [Fact]
    public void Normalize_MetaCdnImage_IsAccepted()
    {
        const string metaCdn = "https://instagram.ficn2-1.fna.fbcdn.net/v/t51/real.jpg";

        Assert.Equal(metaCdn, Normalizer.Normalize(PostUrl, Candidate(image: metaCdn))!.PreviewImageUrl);
    }

    [Fact]
    public void Normalize_StripsControlCharactersAndCapsLength()
    {
        var result = Normalizer.Normalize(
            PostUrl,
            Candidate(title: "a\u0000b\tc\n" + new string('x', 1000), url: null));

        var title = result!.Title!;
        Assert.StartsWith("ab c x", title);
        Assert.DoesNotContain('\u0000', title);
        Assert.True(title.Length <= 300);
    }
}
