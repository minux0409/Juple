using Juple.Application.UrlMetadata;
using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

public sealed class HtmlTitleExtractorTests
{
    [Fact]
    public async Task ExtractAsync_PrefersOpenGraphTitle_OverEverythingElse()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="OG Title" />
            <meta name="twitter:title" content="Twitter Title" />
            <title>HTML Title</title>
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("OG Title", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToTwitterTitle_WhenNoOpenGraphTitle()
    {
        const string html = """
            <html><head>
            <meta name="twitter:title" content="Twitter Title" />
            <title>HTML Title</title>
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Twitter Title", title);
        Assert.Equal(UrlMetadataSource.Twitter, source);
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToHtmlTitle_WhenNoMetaTags()
    {
        const string html = "<html><head><title>HTML Title</title></head></html>";

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("HTML Title", title);
        Assert.Equal(UrlMetadataSource.HtmlTitle, source);
    }

    [Fact]
    public async Task ExtractAsync_WhenBlankOpenGraphContent_FallsThroughToTwitter()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="   " />
            <meta name="twitter:title" content="Twitter Title" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Twitter Title", title);
        Assert.Equal(UrlMetadataSource.Twitter, source);
    }

    [Fact]
    public async Task ExtractAsync_WhenNoTitleAnywhere_ReturnsNull()
    {
        const string html = "<html><head></head><body>No title here.</body></html>";

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(title);
        Assert.Null(source);
    }

    [Fact]
    public async Task ExtractAsync_NeverReadsScriptOrStyleTextAsTitle()
    {
        const string html = """
            <html><head>
            <style>body { color: red; }</style>
            <script>document.title = "should not be used";</script>
            </head><body></body></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(title);
        Assert.Null(source);
    }

    [Fact]
    public async Task ExtractAsync_TolerateMalformedHtml_WithoutThrowing()
    {
        const string html = "<html><head><title>Unclosed Title<body>Missing closing tags";

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.NotNull(title);
    }

    [Fact]
    public async Task ExtractAsync_CollapsesInternalWhitespaceAndTrims()
    {
        const string html = "<html><head><title>  Some    \n  Title  </title></head></html>";

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Some Title", title);
    }

    [Fact]
    public async Task ExtractAsync_TruncatesOverlyLongTitle()
    {
        var longTitle = new string('a', 400);
        var html = $"<html><head><title>{longTitle}</title></head></html>";

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.NotNull(title);
        Assert.True(title!.Length <= 300);
    }

    [Fact]
    public async Task ExtractAsync_DecodesHtmlEntities()
    {
        const string html = "<html><head><title>Tom &amp; Jerry</title></head></html>";

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Tom & Jerry", title);
    }

    [Theory]
    [InlineData("Instagram")]
    [InlineData("instagram")]
    [InlineData("Login • Instagram")]
    [InlineData("Log in • Instagram")]
    public async Task ExtractAsync_FiltersGenericLoginWallTitles(string genericTitle)
    {
        var html = $"<html><head><title>{genericTitle}</title></head></html>";

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(title);
        Assert.Null(source);
    }

    [Fact]
    public async Task ExtractAsync_AllowsRealInstagramContentTitle()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="A real photo caption - Instagram" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("A real photo caption - Instagram", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }

    [Fact]
    public async Task ExtractAsync_PrefersOpenGraphSecureImage_OverEverythingElse()
    {
        const string html = """
            <html><head>
            <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg" />
            <meta property="og:image" content="https://cdn.example.com/plain.jpg" />
            <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg" />
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/secure.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToOpenGraphImage_WhenNoSecureImage()
    {
        const string html = """
            <html><head>
            <meta property="og:image" content="https://cdn.example.com/plain.jpg" />
            <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg" />
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/plain.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToTwitterImage_WhenNoOpenGraphImage()
    {
        const string html = """
            <html><head>
            <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg" />
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/twitter.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_WhenNoImageMetaTagsAnywhere_ReturnsNullImage()
    {
        const string html = "<html><head><title>No image here</title></head></html>";

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageUrl);
    }

    [Theory]
    [InlineData("data:image/png;base64,aaaa")]
    [InlineData("javascript:alert(1)")]
    [InlineData("file:///etc/passwd")]
    [InlineData("blob:https://example.com/abc")]
    [InlineData("/relative/path.jpg")]
    [InlineData("not a url")]
    public async Task ExtractAsync_RejectsNonHttpImageUrls(string disallowedImageUrl)
    {
        var html = $"""
            <html><head>
            <meta property="og:image" content="{disallowedImageUrl}" />
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_RejectsOverlyLongImageUrl()
    {
        var tooLongImageUrl = "https://cdn.example.com/" + new string('a', 4096);
        var html = $"""
            <html><head>
            <meta property="og:image" content="{tooLongImageUrl}" />
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_TitleAndImage_AreIndependent()
    {
        const string html = """
            <html><head>
            <meta property="og:image" content="https://cdn.example.com/plain.jpg" />
            </head></html>
            """;

        var (title, source, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(title);
        Assert.Null(source);
        Assert.Equal("https://cdn.example.com/plain.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_UsesBareUrlStringImage_WhenNoOpenGraphOrTwitterImage()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">
            {"@context":"https://schema.org","@type":"Article","image":"https://cdn.example.com/jsonld.jpg"}
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, previewImageSource) =
            await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/jsonld.jpg", previewImageUrl);
        Assert.Equal(UrlMetadataImageSource.JsonLd, previewImageSource);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_UsesImageObjectUrlProperty()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">
            {"@type":"Product","image":{"@type":"ImageObject","url":"https://cdn.example.com/imageobject.jpg"}}
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/imageobject.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_UsesFirstUrlFromImageArray()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">
            {"@type":"Product","image":["https://cdn.example.com/first.jpg","https://cdn.example.com/second.jpg"]}
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/first.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_UnwrapsTopLevelArrayOfNodes()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">
            [{"@type":"BreadcrumbList"},{"@type":"Product","image":"https://cdn.example.com/from-array-node.jpg"}]
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/from-array-node.jpg", previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_OpenGraphAndTwitterImageStillTakePriorityOverIt()
    {
        const string html = """
            <html><head>
            <meta property="og:image" content="https://cdn.example.com/og.jpg" />
            <script type="application/ld+json">
            {"@type":"Product","image":"https://cdn.example.com/jsonld.jpg"}
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, previewImageSource) =
            await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("https://cdn.example.com/og.jpg", previewImageUrl);
        Assert.Equal(UrlMetadataImageSource.OpenGraphImage, previewImageSource);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_MalformedScriptBlock_IsSkippedWithoutThrowing()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">not valid json at all</script>
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_JsonLd_RejectsNonHttpImageUrl()
    {
        const string html = """
            <html><head>
            <script type="application/ld+json">
            {"@type":"Product","image":"javascript:alert(1)"}
            </script>
            </head></html>
            """;

        var (_, _, previewImageUrl, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageUrl);
    }

    [Fact]
    public async Task ExtractAsync_ImageSource_ReportsOpenGraphSecureUrl()
    {
        const string html = """
            <html><head>
            <meta property="og:image:secure_url" content="https://cdn.example.com/secure.jpg" />
            </head></html>
            """;

        var (_, _, _, previewImageSource) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal(UrlMetadataImageSource.OpenGraphSecureUrl, previewImageSource);
    }

    [Fact]
    public async Task ExtractAsync_ImageSource_ReportsTwitterImage()
    {
        const string html = """
            <html><head>
            <meta name="twitter:image" content="https://cdn.example.com/twitter.jpg" />
            </head></html>
            """;

        var (_, _, _, previewImageSource) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal(UrlMetadataImageSource.TwitterImage, previewImageSource);
    }

    [Fact]
    public async Task ExtractAsync_ImageSource_IsNullWhenNoImageFound()
    {
        const string html = "<html><head><title>No image here</title></head></html>";

        var (_, _, _, previewImageSource) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(previewImageSource);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_ReplacesDisplayNameWithRealUsername_FromLikesCommentsDescription()
    {
        // Real, currently-live Instagram og:description format (confirmed via direct production
        // fetch during device verification): "{N} likes, {M} comments - {username} on {date}:
        // "{caption}"" - a fixed English template regardless of the account's/caption's own
        // language. This is the actual bug report's account, verified live: display name
        // "오아이 페이지", real username "oi.pages".
        const string html = """
            <html><head>
            <meta property="og:title" content="오아이 페이지 on Instagram: &quot;긴급 속보&quot;" />
            <meta property="og:description" content="2,028 likes, 443 comments - oi.pages on August 27, 2026: &quot;긴급 속보&quot;" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("oi.pages on Instagram: \"긴급 속보\"", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_HandlesSingularLikeAndComment()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="Display Name on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="1 like, 1 comment - realhandle on January 1, 2026: &quot;caption&quot;" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "instagram.com");

        Assert.Equal("realhandle on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_WhenNoHandleAnywhere_KeepsDisplayNameTitleUnchanged()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="낄낄엔터 on Instagram: &quot;caption&quot;" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("낄낄엔터 on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_NeverPullsHandleMentionedInsideCaptionBody()
    {
        // Regression test for a real misattribution bug found during device verification: a news/
        // aggregation account's own caption credited a federation's handle as its source
        // ("대한축구협회(@thekfa)는...") - that inline mention must never be mistaken for the
        // post's own author, even though it technically matches "(@handle)"-shaped text. Only a
        // handle inside Instagram's own fixed "{N} likes, {M} comments - {username} on {date}:"
        // template (never inside the quoted caption) is trusted.
        const string html = """
            <html><head>
            <meta property="og:title" content="_tripgoing on Instagram: &quot;대한축구협회(@thekfa)는 오늘...&quot;" />
            <meta property="og:description" content="360 likes, 11 comments - _tripgoing on September 14, 2026: &quot;대한축구협회(@thekfa)는 오늘...&quot;" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("_tripgoing on Instagram: \"대한축구협회(@thekfa)는 오늘...\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_IgnoresParenthesizedHandleMention_WhenNotInLikesCommentsTemplate()
    {
        // An older, unverified assumption about the description format (a bare "(@handle)" marker
        // anywhere in the text) must no longer trigger a swap - only the real likes/comments
        // template does.
        const string html = """
            <html><head>
            <meta property="og:title" content="Display Name on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="Some other account (@someone_else) reposted this - Display Name on Instagram: &quot;caption&quot;" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("Display Name on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_PrefersCanonicalUrlHandle_OverLikesCommentsDescription_WhenBothPresentAndDiffer()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="Display Name on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="10 likes, 2 comments - handlefromdescription on January 1, 2026: &quot;caption&quot;" />
            <meta property="og:url" content="https://www.instagram.com/handlefromurl/p/Abc123/" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("handlefromurl on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_UsesCanonicalUrlHandle_WhenLikesCommentsTemplateIsAbsent()
    {
        // The exact real-world bug this fix addresses: og:title carries a Korean display name
        // ("정치크러쉬") instead of the real handle ("politics_crush"), and og:description has no
        // likes/comments prefix to fall back on (confirmed via direct production fetch,
        // device verification 2026-09-17 - some accounts' engagement counts are not exposed in
        // this template at all). og:url still carries the real handle in its canonical path.
        const string html = """
            <html><head>
            <meta property="og:title" content="정치크러쉬 on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="some other description text with no likes/comments prefix at all: &quot;caption&quot;" />
            <meta property="og:url" content="https://www.instagram.com/politics_crush/p/DckbdWumlVg/" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("politics_crush on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_WhenCanonicalUrlHasNoHandleSegment_FallsBackToLikesCommentsDescription()
    {
        // al:android:url/the plain <link rel="canonical"> shape - "/p/{shortcode}/" with no handle
        // segment at all - must not be mistaken for a handle-bearing canonical URL.
        const string html = """
            <html><head>
            <meta property="og:title" content="Display Name on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="5 likes, 1 comment - realhandle on January 1, 2026: &quot;caption&quot;" />
            <meta property="og:url" content="https://www.instagram.com/p/Abc123/" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("realhandle on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_WhenNeitherCanonicalUrlNorDescriptionHasATrustworthyHandle_NeverGuesses()
    {
        // Neither signal is usable - og:url has no handle segment, og:description has no
        // likes/comments prefix - the display-name title must be left exactly as-is, never a
        // guessed/inferred handle.
        const string html = """
            <html><head>
            <meta property="og:title" content="정치크러쉬 on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="some description with no likes/comments prefix: &quot;caption&quot;" />
            <meta property="og:url" content="https://www.instagram.com/p/DckbdWumlVg/" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("정치크러쉬 on Instagram: \"caption\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_CanonicalUrlHandle_NeverInferredFromCaptionMention()
    {
        // The existing caption-mention-misattribution guard must still hold even with the new
        // og:url source in play - a reel URL for account "_tripgoing" whose caption credits
        // "(@thekfa)" must never end up with "thekfa" as the author via either source.
        const string html = """
            <html><head>
            <meta property="og:title" content="_tripgoing on Instagram: &quot;대한축구협회(@thekfa)는 오늘...&quot;" />
            <meta property="og:description" content="360 likes, 11 comments - _tripgoing on September 14, 2026: &quot;대한축구협회(@thekfa)는 오늘...&quot;" />
            <meta property="og:url" content="https://www.instagram.com/_tripgoing/reel/Xyz789/" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.instagram.com");

        Assert.Equal("_tripgoing on Instagram: \"대한축구협회(@thekfa)는 오늘...\"", title);
    }

    [Fact]
    public async Task ExtractAsync_Instagram_NeverAppliesUsernameSwap_OnNonInstagramHost()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="낄낄엔터 on Instagram: &quot;caption&quot;" />
            <meta property="og:description" content="10 likes, 2 comments - kkilkkil.enter on January 1, 2026: &quot;caption&quot;" />
            </head></html>
            """;

        var (title, _, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "some-other-site.com");

        Assert.Equal("낄낄엔터 on Instagram: \"caption\"", title);
    }

    [Theory]
    [InlineData("- YouTube")]
    [InlineData("YouTube")]
    [InlineData("  -   YouTube  ")]
    public async Task ExtractAsync_YouTube_TreatsKnownPlaceholderOgTitle_AsNotFound_AndFallsThroughToTwitter(
        string placeholderOgTitle)
    {
        var html = $"""
            <html><head>
            <meta property="og:title" content="{placeholderOgTitle}" />
            <meta name="twitter:title" content="Real Video Title" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.youtube.com");

        Assert.Equal("Real Video Title", title);
        Assert.Equal(UrlMetadataSource.Twitter, source);
    }

    [Fact]
    public async Task ExtractAsync_YouTube_WhenEveryCandidateIsAKnownPlaceholder_ReturnsNull_NeverThePlaceholder()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="- YouTube" />
            <meta name="twitter:title" content="YouTube" />
            <title>- YouTube</title>
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.youtube.com");

        Assert.Null(title);
        Assert.Null(source);
    }

    [Fact]
    public async Task ExtractAsync_YouTube_RealTitleEndingInSiteSuffix_IsUsedAsIs_NoUnnecessaryFallback()
    {
        const string html = """
            <html><head>
            <meta property="og:title" content="Actual Video Title - YouTube" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "www.youtube.com");

        Assert.Equal("Actual Video Title - YouTube", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }

    [Fact]
    public async Task ExtractAsync_NonYouTubeHost_NeverFiltersALiteral_YouTube_Title()
    {
        // The YouTube-only placeholder filter is strictly host-gated - a page on some other site
        // whose real, author-chosen title happens to be the bare word "YouTube" (e.g. an article
        // about YouTube) must still be trusted as-is everywhere except youtube.com itself.
        const string html = """
            <html><head>
            <meta property="og:title" content="YouTube" />
            </head></html>
            """;

        var (title, source, _, _) = await HtmlTitleExtractor.ExtractAsync(
            html, CancellationToken.None, "some-blog.example.com");

        Assert.Equal("YouTube", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }
}
