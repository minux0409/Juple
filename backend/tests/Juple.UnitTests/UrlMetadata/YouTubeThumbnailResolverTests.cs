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
}
