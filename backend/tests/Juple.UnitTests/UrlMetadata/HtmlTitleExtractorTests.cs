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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Twitter Title", title);
        Assert.Equal(UrlMetadataSource.Twitter, source);
    }

    [Fact]
    public async Task ExtractAsync_FallsBackToHtmlTitle_WhenNoMetaTags()
    {
        const string html = "<html><head><title>HTML Title</title></head></html>";

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Twitter Title", title);
        Assert.Equal(UrlMetadataSource.Twitter, source);
    }

    [Fact]
    public async Task ExtractAsync_WhenNoTitleAnywhere_ReturnsNull()
    {
        const string html = "<html><head></head><body>No title here.</body></html>";

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Null(title);
        Assert.Null(source);
    }

    [Fact]
    public async Task ExtractAsync_TolerateMalformedHtml_WithoutThrowing()
    {
        const string html = "<html><head><title>Unclosed Title<body>Missing closing tags";

        var (title, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.NotNull(title);
    }

    [Fact]
    public async Task ExtractAsync_CollapsesInternalWhitespaceAndTrims()
    {
        const string html = "<html><head><title>  Some    \n  Title  </title></head></html>";

        var (title, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("Some Title", title);
    }

    [Fact]
    public async Task ExtractAsync_TruncatesOverlyLongTitle()
    {
        var longTitle = new string('a', 400);
        var html = $"<html><head><title>{longTitle}</title></head></html>";

        var (title, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.NotNull(title);
        Assert.True(title!.Length <= 300);
    }

    [Fact]
    public async Task ExtractAsync_DecodesHtmlEntities()
    {
        const string html = "<html><head><title>Tom &amp; Jerry</title></head></html>";

        var (title, _) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

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

        var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, CancellationToken.None);

        Assert.Equal("A real photo caption - Instagram", title);
        Assert.Equal(UrlMetadataSource.OpenGraph, source);
    }
}
