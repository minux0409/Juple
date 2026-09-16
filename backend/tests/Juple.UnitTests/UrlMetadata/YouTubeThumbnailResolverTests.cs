using System.Net;
using Juple.Infrastructure.UrlMetadata;

namespace Juple.UnitTests.UrlMetadata;

/// <summary>
/// Exercises the quality fallback chain via a stub HttpMessageHandler - no real network/CDN
/// involved. See UrlMetadataResolverTests for the end-to-end wiring into ResolveAsync.
/// </summary>
public sealed class YouTubeThumbnailResolverTests
{
    private sealed class StubHttpMessageHandler(Func<Uri, HttpResponseMessage> handler) : HttpMessageHandler
    {
        public List<Uri> RequestedUris { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            RequestedUris.Add(request.RequestUri!);
            return Task.FromResult(handler(request.RequestUri!));
        }
    }

    private static HttpResponseMessage Ok(int contentLength = 50_000) =>
        new(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[contentLength]) };

    private static HttpResponseMessage NotFound() => new(HttpStatusCode.NotFound);

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenNotAYouTubeThumbnailUrl_ReturnsItUnchanged_AndMakesNoRequest()
    {
        var handler = new StubHttpMessageHandler(_ => throw new InvalidOperationException("Must never be called."));
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://example.com/some/other/image.jpg", CancellationToken.None);

        Assert.Equal("https://example.com/some/other/image.jpg", url);
        Assert.Null(variant);
        Assert.Empty(handler.RequestedUris);
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenMaxresExists_ReturnsItAsIs_WithOneRequest()
    {
        var handler = new StubHttpMessageHandler(_ => Ok());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", url);
        Assert.Equal("maxresdefault", variant);
        Assert.Single(handler.RequestedUris);
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenMaxresIs404_FallsBackThroughSdToHq()
    {
        var handler = new StubHttpMessageHandler(uri => uri.AbsoluteUri.Contains("hqdefault") ? Ok() : NotFound());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg", url);
        Assert.Equal("hqdefault", variant);
        // maxresdefault, sddefault both checked and rejected before hqdefault succeeds.
        Assert.Equal(3, handler.RequestedUris.Count);
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenNoQualityExists_ReturnsNull_NeverGuessing()
    {
        var handler = new StubHttpMessageHandler(_ => NotFound());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/deadbeef1234/maxresdefault.jpg", CancellationToken.None);

        Assert.Null(url);
        Assert.Null(variant);
        Assert.Equal(5, handler.RequestedUris.Count);
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenCandidateAlreadyNamesALowerQuality_NeverChecksHigherQualities()
    {
        var handler = new StubHttpMessageHandler(_ => Ok());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/abc123XYZ_/hqdefault.jpg", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/hqdefault.jpg", url);
        Assert.Equal("hqdefault", variant);
        Assert.Single(handler.RequestedUris);
        Assert.DoesNotContain(handler.RequestedUris, uri => uri.AbsoluteUri.Contains("maxresdefault"));
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_WhenResponseIsSuspiciouslySmall_TreatsItAsMissing_AndFallsBack()
    {
        var handler = new StubHttpMessageHandler(uri =>
            uri.AbsoluteUri.Contains("maxresdefault") ? Ok(contentLength: 200) : Ok());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/sddefault.jpg", url);
        Assert.Equal("sddefault", variant);
    }

    [Fact]
    public async Task ResolveExistingThumbnailAsync_UsesHeadRequests_NeverDownloadingTheFullImage()
    {
        HttpMethod? observedMethod = null;
        var handler = new StubHttpMessageHandler(_ => Ok());
        var httpClient = new HttpClient(handler);

        await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            httpClient, "https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", CancellationToken.None);

        // Re-run capturing the method explicitly (StubHttpMessageHandler above only records URIs).
        var methodCapturingHandler = new MethodCapturingHandler();
        using var client2 = new HttpClient(methodCapturingHandler);
        await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
            client2, "https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", CancellationToken.None);
        observedMethod = methodCapturingHandler.LastMethod;

        Assert.Equal(HttpMethod.Head, observedMethod);
    }

    private sealed class MethodCapturingHandler : HttpMessageHandler
    {
        public HttpMethod? LastMethod { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            LastMethod = request.Method;
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new ByteArrayContent(new byte[50_000]),
            });
        }
    }

    // TryExtractVideoIdFromPageUrl - the fallback path used when the fetched HTML gave no
    // og:image candidate at all (see UrlMetadataResolver's own remarks on why that happens on
    // Azure Dev and must not mean thumbnail enrichment is skipped outright).
    [Theory]
    [InlineData("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://m.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&t=30s", "dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://youtu.be/dQw4w9WgXcQ?t=30", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    // /live/{videoId} - a real-device regression: manual-save of a live-stream watch page (title
    // resolved fine, thumbnail never did) traced to this path shape simply not being recognized
    // at all, so the URL-based fallback below never even attempted to extract a video ID for it.
    // The trailing "?si=..." share-tracking query (YouTube's own live-share parameter) must never
    // affect extraction - only Uri.AbsolutePath is inspected for this shape.
    [InlineData("https://www.youtube.com/live/dQw4w9WgXcQ", "dQw4w9WgXcQ")]
    [InlineData("https://www.youtube.com/live/dQw4w9WgXcQ?si=someTrackingToken", "dQw4w9WgXcQ")]
    [InlineData("https://youtube.com/live/dQw4w9WgXcQ?si=abc&feature=share", "dQw4w9WgXcQ")]
    public void TryExtractVideoIdFromPageUrl_ExtractsTheVideoId_FromEveryRealYouTubeUrlShape(
        string pageUrl, string expectedVideoId)
    {
        var success = YouTubeThumbnailResolver.TryExtractVideoIdFromPageUrl(new Uri(pageUrl), out var videoId);

        Assert.True(success);
        Assert.Equal(expectedVideoId, videoId);
    }

    [Theory]
    [InlineData("https://example.com/watch?v=dQw4w9WgXcQ")] // not a YouTube host at all
    [InlineData("https://www.youtube.com/")] // no video id anywhere
    [InlineData("https://www.youtube.com/results?search_query=cats")] // a non-video YouTube page
    [InlineData("https://www.youtube.com/watch?v=")] // empty v= value
    [InlineData("https://www.youtube.com/live/")] // malformed /live/ - no video id segment at all
    [InlineData("https://www.youtube.com/live/?si=abc")] // malformed /live/ - query only, still no id
    public void TryExtractVideoIdFromPageUrl_ReturnsFalse_WhenNoVideoIdCanBeFound(string pageUrl)
    {
        var success = YouTubeThumbnailResolver.TryExtractVideoIdFromPageUrl(new Uri(pageUrl), out var videoId);

        Assert.False(success);
        Assert.Null(videoId);
    }

    [Fact]
    public async Task ResolveExistingThumbnailForVideoIdAsync_StartsFromMaxres_JustLikeAnHtmlDerivedCandidateWould()
    {
        var handler = new StubHttpMessageHandler(_ => Ok());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailForVideoIdAsync(
            httpClient, "dQw4w9WgXcQ", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", url);
        Assert.Equal("maxresdefault", variant);
    }

    [Fact]
    public async Task ResolveExistingThumbnailForVideoIdAsync_FallsBackThroughQualities_TheSameWayTheHtmlDerivedPathDoes()
    {
        var handler = new StubHttpMessageHandler(uri => uri.AbsoluteUri.Contains("hqdefault") ? Ok() : NotFound());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailForVideoIdAsync(
            httpClient, "jNQXAC9IVRw", CancellationToken.None);

        Assert.Equal("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg", url);
        Assert.Equal("hqdefault", variant);
    }

    [Fact]
    public async Task ResolveExistingThumbnailForVideoIdAsync_WhenNoQualityExists_ReturnsNull_NeverGuessing()
    {
        var handler = new StubHttpMessageHandler(_ => NotFound());
        var httpClient = new HttpClient(handler);

        var (url, variant) = await YouTubeThumbnailResolver.ResolveExistingThumbnailForVideoIdAsync(
            httpClient, "deadbeef1234", CancellationToken.None);

        Assert.Null(url);
        Assert.Null(variant);
    }
}
