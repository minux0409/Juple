using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.UrlMetadata;

/// <summary>
/// Exercises UrlMetadataResolver's request-level policy (redirect following/limit, content-type
/// gate, response-size cap, caching, error categorization) via a stub HttpMessageHandler - not the
/// real SocketsHttpHandler/ConnectCallback SSRF wiring (see UrlMetadataConnectGuardTests and
/// PrivateNetworkAddressGuardTests for that boundary), so these tests never touch a real socket
/// and are fully deterministic.
/// </summary>
public sealed class UrlMetadataResolverTests
{
    private sealed class EndlessHtmlStream(int maxChunkBytes) : Stream
    {
        public long BytesRead { get; private set; }
        public bool Disposed { get; private set; }
        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => BytesRead; set => throw new NotSupportedException(); }
        public override ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            Assert.True(cancellationToken.CanBeCanceled);
            cancellationToken.ThrowIfCancellationRequested();
            var count = Math.Min(maxChunkBytes, buffer.Length);
            buffer.Span[..count].Fill((byte)' ');
            BytesRead += count;
            return ValueTask.FromResult(count);
        }
        protected override void Dispose(bool disposing) { Disposed = true; base.Dispose(disposing); }
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override void Flush() => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    [Theory]
    [InlineData(8192)]
    [InlineData(997)]
    public async Task ResolveAsync_UnknownLengthInfiniteStreamStopsAtOneMiBAndDisposes(int chunkBytes)
    {
        var stream = new EndlessHtmlStream(chunkBytes);
        var resolver = CreateResolver((_, _) =>
        {
            var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new StreamContent(stream) };
            response.Content.Headers.ContentType = new MediaTypeHeaderValue("text/html");
            Assert.Null(response.Content.Headers.ContentLength);
            return response;
        }, out _, out var cache);
        using (cache)
        {
            Assert.Null((await resolver.ResolveAsync("https://example.com/large")).Title);
            Assert.Equal(1024 * 1024, stream.BytesRead);
            Assert.True(stream.Disposed);
        }
    }

    private sealed class RedirectDnsResolver : IDnsResolver
    {
        public Task<IPAddress[]> ResolveAsync(string host, CancellationToken cancellationToken) =>
            Task.FromResult(new[] { host == "example.com" ? IPAddress.Parse("8.8.8.8") : IPAddress.Loopback });
    }

    [Theory]
    [InlineData("http://127.0.0.1/private")]
    [InlineData("http://internal.example/private")]
    [InlineData("http://[::1]/private")]
    public async Task ResolveAsync_PublicRedirectToPrivateTargetIsBlocked(string target)
    {
        var reachedTarget = false;
        var resolver = CreateResolver((request, count) =>
        {
            // Run the same guard as the production ConnectCallback before any simulated I/O.
            UrlMetadataConnectGuard.ResolveAndValidateAsync(new RedirectDnsResolver(),
                request.RequestUri!.IdnHost, CancellationToken.None).GetAwaiter().GetResult();
            if (count > 1) reachedTarget = true;
            return new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri(target) } };
        }, out _, out var cache);
        using (cache)
        {
            Assert.Null((await resolver.ResolveAsync("https://example.com/start")).Title);
            Assert.False(reachedTarget);
        }
    }

    private sealed class StubHttpMessageHandler(Func<HttpRequestMessage, int, HttpResponseMessage> handler)
        : HttpMessageHandler
    {
        public int CallCount { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request, CancellationToken cancellationToken)
        {
            CallCount++;
            return Task.FromResult(handler(request, CallCount));
        }
    }

    private static UrlMetadataResolver CreateResolver(
        Func<HttpRequestMessage, int, HttpResponseMessage> handler,
        out StubHttpMessageHandler stubHandler,
        out IMemoryCache memoryCache)
    {
        stubHandler = new StubHttpMessageHandler(handler);
        var httpClient = new HttpClient(stubHandler) { BaseAddress = null };
        memoryCache = new MemoryCache(new MemoryCacheOptions());
        return new UrlMetadataResolver(
            httpClient, memoryCache, TimeProvider.System, NullLogger<UrlMetadataResolver>.Instance);
    }

    private static HttpResponseMessage HtmlResponse(string html, string mediaType = "text/html")
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(html)),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue(mediaType);
        return response;
    }

    private static HttpResponseMessage OEmbedJsonResponse(string json)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK)
        {
            Content = new ByteArrayContent(Encoding.UTF8.GetBytes(json)),
        };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return response;
    }

    private static bool IsOEmbedRequest(HttpRequestMessage request) =>
        request.RequestUri!.Host.Equals("www.youtube.com", StringComparison.OrdinalIgnoreCase)
        && request.RequestUri.AbsolutePath == "/oembed";

    [Fact]
    public async Task ResolveAsync_ExtractsOgTitle_EndToEnd()
    {
        var resolver = CreateResolver(
            (_, _) => HtmlResponse("<html><head><meta property=\"og:title\" content=\"Real Title\" /></head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/a");

            Assert.Equal("Real Title", result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_FollowsRedirect_AndUsesFinalPageTitle()
    {
        var resolver = CreateResolver(
            (request, callCount) => callCount == 1
                ? new HttpResponseMessage(HttpStatusCode.Found)
                {
                    Headers = { Location = new Uri("https://example.com/final") },
                }
                : HtmlResponse("<html><head><title>Final Page</title></head></html>"),
            out var handler, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/start");

            Assert.Equal("Final Page", result.Title);
            Assert.Equal(2, handler.CallCount);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenRedirectsExceedLimit_ReturnsNoTitle()
    {
        var resolver = CreateResolver(
            (_, callCount) => new HttpResponseMessage(HttpStatusCode.Found)
            {
                Headers = { Location = new Uri($"https://example.com/hop{callCount}") },
            },
            out var handler, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/start");
            Assert.Null(result.Title);
            // 1 initial + 5 allowed redirects = 6 calls before the 6th redirect is rejected as over-limit.
            Assert.Equal(6, handler.CallCount);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenRedirectChainRevisitsAnEarlierUri_ReturnsNoTitle_WithoutRequestingItAgain()
    {
        var resolver = CreateResolver(
            (request, callCount) => new HttpResponseMessage(HttpStatusCode.Found)
            {
                // A short A -> B -> A cycle, well under MaxRedirects - only the loop check (not the
                // redirect-count limit) can catch this.
                Headers = { Location = new Uri(request.RequestUri!.AbsoluteUri.EndsWith("/start") ? "https://example.com/a" : "https://example.com/start") },
            },
            out var handler, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/start");
            Assert.Null(result.Title);
            // /start then /a - the loop is detected before a third request would re-request /start.
            Assert.Equal(2, handler.CallCount);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenRedirectTargetHasNonDefaultPort_ReturnsNoTitle_AndNeverRequestsIt()
    {
        var resolver = CreateResolver(
            (_, callCount) => callCount == 1
                ? new HttpResponseMessage(HttpStatusCode.Found)
                {
                    Headers = { Location = new Uri("https://example.com:8443/internal") },
                }
                : throw new InvalidOperationException("Must never request the disallowed-port target."),
            out var handler, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/start");
            Assert.Null(result.Title);
            Assert.Equal(1, handler.CallCount);
        }
    }

    [Fact]
    public async Task ResolveAsync_RejectsNonHtmlContentType()
    {
        var resolver = CreateResolver(
            (_, _) => HtmlResponse("<html><head><title>Should be ignored</title></head></html>", "application/pdf"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/file.pdf");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_RejectsDeclaredOversizedContentLength_WithoutReadingBody()
    {
        var resolver = CreateResolver(
            (_, _) =>
            {
                var response = HtmlResponse("<html><head><title>Unreachable</title></head></html>");
                response.Content.Headers.ContentLength = 5 * 1024 * 1024; // 5 MB, declared but not actually sent
                return response;
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/huge");

            Assert.Null(result.Title);
        }
    }

    /// <summary>
    /// ByteArrayContent auto-computes Content-Length from the buffer, which would otherwise trip
    /// the early "declared oversized - bail without reading" check instead of exercising the
    /// streaming truncation path this test targets - clearing it simulates a response whose length
    /// is not known upfront (e.g. chunked transfer), which is the case that actually streams and
    /// truncates at the byte cap.
    /// </summary>
    private static HttpResponseMessage HtmlResponseWithUnknownLength(string html)
    {
        var response = HtmlResponse(html);
        response.Content.Headers.ContentLength = null;
        return response;
    }

    [Fact]
    public async Task ResolveAsync_TruncatesBody_ButStillParsesTitleFoundWithinTheCap()
    {
        // A large trailing comment pads the body past 1 MB, but the title tag itself is near the
        // top - well within the cap - so it must still be found from the truncated read.
        var padding = new string('x', 2 * 1024 * 1024);
        var html = $"<html><head><title>Near The Top</title></head><body><!--{padding}--></body></html>";

        var resolver = CreateResolver((_, _) => HtmlResponseWithUnknownLength(html), out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/large-page");

            Assert.Equal("Near The Top", result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenTitleIsBeyondTheByteCap_ReturnsNoTitle()
    {
        var padding = new string('x', 2 * 1024 * 1024);
        var html = $"<html><head><!--{padding}--><title>Past The Cap</title></head></html>";

        var resolver = CreateResolver((_, _) => HtmlResponseWithUnknownLength(html), out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/large-page-2");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenStatusIsNotSuccess_ReturnsNoTitle()
    {
        var resolver = CreateResolver(
            (_, _) => new HttpResponseMessage(HttpStatusCode.NotFound),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/missing");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenRequestIsCanceled_ReturnsNoTitle_WithoutThrowing()
    {
        var resolver = CreateResolver(
            (_, _) => throw new TaskCanceledException("simulated timeout"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/slow");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenUrlIsNotAbsolute_ReturnsNoTitle_WithoutThrowing()
    {
        var resolver = CreateResolver((_, _) => HtmlResponse("<html></html>"), out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("not a url");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenYouTubeMaxresThumbnailExists_KeepsItAsIs()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[50_000]) }
                : HtmlResponse(
                    "<html><head><meta property=\"og:title\" content=\"A Video\" />"
                    + "<meta property=\"og:image\" content=\"https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg\" />"
                    + "</head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenYouTubeMaxresThumbnailIs404_PersistsTheWorkingFallbackInstead()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (request.Method == HttpMethod.Head)
                {
                    return request.RequestUri!.AbsoluteUri.Contains("hqdefault")
                        ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[50_000]) }
                        : new HttpResponseMessage(HttpStatusCode.NotFound);
                }

                return HtmlResponse(
                    "<html><head><meta property=\"og:title\" content=\"An Old Video\" />"
                    + "<meta property=\"og:image\" content=\"https://i.ytimg.com/vi/jNQXAC9IVRw/maxresdefault.jpg\" />"
                    + "</head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=jNQXAC9IVRw");

            Assert.Equal("https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg", result.PreviewImageUrl);
            // The title itself is completely unaffected by the image-verification fallback.
            Assert.Equal("An Old Video", result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenNoYouTubeThumbnailQualityExists_PreviewImageUrlIsNull_NotAGuess()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? new HttpResponseMessage(HttpStatusCode.NotFound)
                : HtmlResponse(
                    "<html><head><meta property=\"og:image\" content=\"https://i.ytimg.com/vi/deadbeef1234/maxresdefault.jpg\" />"
                    + "</head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=deadbeef1234");

            Assert.Null(result.PreviewImageUrl);
        }
    }

    // Regression coverage for the real Azure Dev root cause: the fetched HTML's <title> parses
    // fine but its whole og: meta block (including og:image) is absent, which previously skipped
    // YouTubeThumbnailResolver entirely (it was only ever invoked with an HTML-derived candidate).
    // The video ID itself comes from the page URL's own structure, not from HTML, so thumbnail
    // enrichment must still run - see YouTubeThumbnailResolver.TryExtractVideoIdFromPageUrl.
    [Fact]
    public async Task ResolveAsync_WhenHtmlHasNoImageMetaTagsAtAll_StillResolvesTheThumbnail_FromTheVideoIdInTheUrl()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[50_000]) }
                // No og:image/twitter:image/JSON-LD anywhere - only a plain <title>, exactly the
                // shape observed from Azure Dev's real YouTube fetches.
                : HtmlResponse("<html><head><title>A Video - YouTube</title></head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("A Video - YouTube", result.Title);
            Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", result.PreviewImageUrl);
        }
    }

    // Real-device regression: a manually-saved /live/{videoId}?si=... URL got its title but no
    // thumbnail - traced to that path shape not being recognized by the video-ID URL extractor at
    // all (see YouTubeThumbnailResolverTests' own /live/ cases for the extractor-level coverage).
    [Fact]
    public async Task ResolveAsync_YouTubeLiveUrl_WithShareTrackingQuery_StillResolvesTheThumbnail_FromTheVideoIdInTheUrl()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[50_000]) }
                : HtmlResponse("<html><head><title>A Live Stream - YouTube</title></head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/live/abc123XYZ_?si=someTrackingToken");

            Assert.Equal("A Live Stream - YouTube", result.Title);
            Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg", result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenHtmlHasNoImageMetaTags_AndNoQualityExistsEither_PreviewImageUrlIsNull_NotAGuess()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? new HttpResponseMessage(HttpStatusCode.NotFound)
                : HtmlResponse("<html><head><title>A Video - YouTube</title></head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=deadbeef1234");

            Assert.Equal("A Video - YouTube", result.Title);
            Assert.Null(result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenHtmlHasNoImageMetaTags_AndUrlHasNoVideoId_NeverAttemptsAnyThumbnailRequest()
    {
        var resolver = CreateResolver(
            (request, _) => request.Method == HttpMethod.Head
                ? throw new InvalidOperationException("Must never probe a thumbnail with no video ID.")
                : HtmlResponse("<html><head><title>Search results - YouTube</title></head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/results?search_query=cats");

            Assert.Null(result.PreviewImageUrl);
        }
    }

    // Instagram's own generic/login-wall/interstitial shell page still declares a syntactically
    // valid og:image - its own static UI-asset icon, always served from static.cdninstagram.com,
    // confirmed via real Azure Dev production data (every PreviewImageUrl saved from an Instagram
    // share so far resolved to exactly this host). That must never be persisted as if it were the
    // real post's photo - "no preview" is correct, a wrong preview is not (docs' "모르면 모른다고
    // 한다" trust principle).
    [Fact]
    public async Task ResolveAsync_Instagram_NeverPersistsTheGenericStaticAssetCdnImage_AsAPostPreview()
    {
        var resolver = CreateResolver(
            (_, _) => HtmlResponse(
                "<html><head><meta property=\"og:title\" content=\"Instagram\" />"
                + "<meta property=\"og:image\" content=\"https://static.cdninstagram.com/rsrc.php/v3/y3/r/some-generic-icon.png\" />"
                + "</head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.instagram.com/p/ABC123xyz/");

            Assert.Null(result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_Instagram_StillPersistsTheRealPostMediaImage_FromTheActualContentCdn()
    {
        var resolver = CreateResolver(
            (_, _) => HtmlResponse(
                "<html><head><meta property=\"og:title\" content=\"someuser on Instagram\" />"
                + "<meta property=\"og:image\" content=\"https://scontent.cdninstagram.com/v/t51/some-real-post-photo.jpg\" />"
                + "</head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.instagram.com/p/ABC123xyz/");

            Assert.Equal("https://scontent.cdninstagram.com/v/t51/some-real-post-photo.jpg", result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_NonInstagramHost_UsingStaticCdninstagramLookingImage_IsUnaffected()
    {
        // The generic-asset rejection is gated on the RESPONSE's own host being Instagram - an
        // unrelated site that happens to reference a static.cdninstagram.com image (e.g. an
        // embed) must not have its own, real image rejected.
        var resolver = CreateResolver(
            (_, _) => HtmlResponse(
                "<html><head><meta property=\"og:image\" content=\"https://static.cdninstagram.com/rsrc.php/v3/y3/r/some-generic-icon.png\" />"
                + "</head></html>"),
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/embeds-instagram-icon");

            Assert.Equal("https://static.cdninstagram.com/rsrc.php/v3/y3/r/some-generic-icon.png", result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_ForwardsSetCookieFromARedirectResponse_ToTheNextHopsRequest()
    {
        string? cookieHeaderSeenOnFinalHop = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://example.com/final") },
                    };
                    redirect.Headers.Add("Set-Cookie", "session=abc123; Path=/; HttpOnly");
                    return redirect;
                }

                cookieHeaderSeenOnFinalHop = request.Headers.TryGetValues("Cookie", out var values)
                    ? string.Join(", ", values)
                    : null;
                return HtmlResponse("<html><head><title>Final Page</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/start");

            Assert.Equal("Final Page", result.Title);
            // Only the "name=value" pair - never Path/HttpOnly/other Set-Cookie attributes, which a
            // request-side Cookie header must not repeat.
            Assert.Equal("session=abc123", cookieHeaderSeenOnFinalHop);
        }
    }

    [Fact]
    public async Task ResolveAsync_AccumulatesCookiesAcrossMultipleRedirectHops()
    {
        string? cookieHeaderSeenOnFinalHop = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://example.com/hop2") },
                    };
                    redirect.Headers.Add("Set-Cookie", "first=one");
                    return redirect;
                }

                if (callCount == 2)
                {
                    Assert.Equal("first=one", request.Headers.GetValues("Cookie").Single());
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://example.com/final") },
                    };
                    redirect.Headers.Add("Set-Cookie", "second=two");
                    return redirect;
                }

                cookieHeaderSeenOnFinalHop = request.Headers.GetValues("Cookie").Single();
                return HtmlResponse("<html><head><title>Final Page</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://example.com/start");

            // Both hops' cookies present by the final request - a real browser completing the same
            // redirect chain accumulates cookies the same way.
            Assert.Contains("first=one", cookieHeaderSeenOnFinalHop);
            Assert.Contains("second=two", cookieHeaderSeenOnFinalHop);
        }
    }

    [Fact]
    public async Task ResolveAsync_WhenNoRedirectOccurs_NeverSendsACookieHeader()
    {
        bool? cookieHeaderPresent = null;
        var resolver = CreateResolver(
            (request, _) =>
            {
                cookieHeaderPresent = request.Headers.Contains("Cookie");
                return HtmlResponse("<html><head><title>No Redirect Here</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://example.com/direct");

            Assert.False(cookieHeaderPresent);
        }
    }

    [Fact]
    public async Task ResolveAsync_NeverCarriesCookiesFromOneResolveCallIntoTheNextOnTheSameResolverInstance()
    {
        bool? cookieHeaderPresentOnSecondCallsFirstRequest = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://example.com/first-final") },
                    };
                    redirect.Headers.Add("Set-Cookie", "leftover=shouldNotSurvive");
                    return redirect;
                }

                if (callCount == 2)
                {
                    return HtmlResponse("<html><head><title>First Call Final</title></head></html>");
                }

                // Third call: a brand new ResolveAsync for a DIFFERENT url, same resolver/HttpClient
                // instance - must start with no cookie jar at all from the previous call.
                cookieHeaderPresentOnSecondCallsFirstRequest = request.Headers.Contains("Cookie");
                return HtmlResponse("<html><head><title>Second Call</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://example.com/first-start");
            await resolver.ResolveAsync("https://example.com/second-start");

            Assert.False(cookieHeaderPresentOnSecondCallsFirstRequest);
        }
    }

    // Cross-origin cookie-scoping security regression suite. The cookie continuity above exists
    // to fix a real Instagram redirect issue (see this file's own remarks), but a redirect chain
    // can just as easily cross from one host to a completely different one - a plain
    // name/value map with no Domain/Path/Secure awareness would forward EVERY cookie collected so
    // far to that unrelated host too, an actual cookie-leak vulnerability. UrlMetadataResolver
    // uses a real System.Net.CookieContainer (RFC 6265 Domain/Path/Secure/Expires matching) per
    // ResolveAsync call specifically to make that structurally impossible, not just
    // policy-avoided - these tests assert the actual per-hop Cookie header, not just that
    // "something" was forwarded.
    [Fact]
    public async Task ResolveAsync_CookieScoped_ToTheIssuingHost_IsForwardedToTheSameHost()
    {
        string? cookieHeaderOnSecondHop = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://a.example/final") },
                    };
                    redirect.Headers.Add("Set-Cookie", "session=onA; Domain=a.example; Path=/");
                    return redirect;
                }

                cookieHeaderOnSecondHop = request.Headers.TryGetValues("Cookie", out var values)
                    ? string.Join(", ", values)
                    : null;
                return HtmlResponse("<html><head><title>A Final</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://a.example/start");

            Assert.Equal("session=onA", cookieHeaderOnSecondHop);
        }
    }

    [Fact]
    public async Task ResolveAsync_HostOnlyCookie_IsNeverForwardedToADifferentHostLaterInTheRedirectChain()
    {
        bool? cookieHeaderPresentOnOtherHost = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    // No Domain attribute at all -> RFC 6265 host-only cookie, valid for a.example
                    // exactly, never any other host, not even a redirect target.
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://b.example/other") },
                    };
                    redirect.Headers.Add("Set-Cookie", "secret=onlyForA");
                    return redirect;
                }

                cookieHeaderPresentOnOtherHost = request.Headers.Contains("Cookie");
                return HtmlResponse("<html><head><title>B Final</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://a.example/start");

            Assert.False(cookieHeaderPresentOnOtherHost);
        }
    }

    [Fact]
    public async Task ResolveAsync_ExplicitParentDomainCookie_IsForwardedToASubdomain_PerRfc6265()
    {
        string? cookieHeaderOnSubdomainHop = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://sub.example.com/final") },
                    };
                    // Domain=.example.com (or example.com, RFC 6265 treats a leading dot as
                    // optional) explicitly opts into being visible to subdomains too.
                    redirect.Headers.Add("Set-Cookie", "wide=domainScoped; Domain=example.com; Path=/");
                    return redirect;
                }

                cookieHeaderOnSubdomainHop = request.Headers.TryGetValues("Cookie", out var values)
                    ? string.Join(", ", values)
                    : null;
                return HtmlResponse("<html><head><title>Sub Final</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://www.example.com/start");

            Assert.Equal("wide=domainScoped", cookieHeaderOnSubdomainHop);
        }
    }

    [Fact]
    public async Task ResolveAsync_PathScopedCookie_IsForwardedUnderThatPath_ButNotOutsideIt()
    {
        var cookieHeadersSeen = new List<string?>();
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://a.example/foo/bar") },
                    };
                    redirect.Headers.Add("Set-Cookie", "scoped=underFoo; Path=/foo");
                    return redirect;
                }

                if (callCount == 2)
                {
                    // /foo/bar is under the cookie's /foo path scope - must be forwarded.
                    cookieHeadersSeen.Add(request.Headers.TryGetValues("Cookie", out var v1) ? v1.Single() : null);
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("https://a.example/other") },
                    };
                    return redirect;
                }

                // /other is a sibling of /foo, not under it - must NOT be forwarded.
                cookieHeadersSeen.Add(request.Headers.Contains("Cookie") ? "present" : null);
                return HtmlResponse("<html><head><title>Other</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://a.example/start");

            Assert.Equal("scoped=underFoo", cookieHeadersSeen[0]);
            Assert.Null(cookieHeadersSeen[1]);
        }
    }

    [Fact]
    public async Task ResolveAsync_SecureCookie_IsForwardedOverHttps_ButNeverOverPlainHttp()
    {
        string? cookieHeaderOnHttpHop = null;
        var resolver = CreateResolver(
            (request, callCount) =>
            {
                if (callCount == 1)
                {
                    // Same host, but the redirect target itself drops to plain http - a Secure
                    // cookie must never be sent over that downgraded connection.
                    var redirect = new HttpResponseMessage(HttpStatusCode.Found)
                    {
                        Headers = { Location = new Uri("http://a.example/final") },
                    };
                    redirect.Headers.Add("Set-Cookie", "secureOnly=value; Secure; Path=/");
                    return redirect;
                }

                cookieHeaderOnHttpHop = request.Headers.TryGetValues("Cookie", out var values)
                    ? string.Join(", ", values)
                    : null;
                return HtmlResponse("<html><head><title>Http Final</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            await resolver.ResolveAsync("https://a.example/start");

            Assert.Null(cookieHeaderOnHttpHop);
        }
    }

    // YouTube oEmbed title fallback - see YouTubeOEmbedTitleResolver. Scenarios A-G per this
    // round's spec.

    [Fact]
    public async Task ResolveAsync_YouTube_WhenHtmlAlreadyHasARealTitle_NeverCallsOEmbed()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    throw new InvalidOperationException("Must never call oEmbed when HTML already has a real title.");
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head><title>A Real Video Title</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("A Real Video Title", result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_WhenHtmlTitleIsTheKnownPlaceholder_FallsBackToOEmbedTitle()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    Assert.Contains("url=", request.RequestUri!.Query);
                    return OEmbedJsonResponse("{\"title\":\"Real oEmbed Title\",\"type\":\"video\"}");
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head><title>- YouTube</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("Real oEmbed Title", result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_WhenHtmlHasNoTitleAtAll_FallsBackToOEmbedTitle()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    return OEmbedJsonResponse("{\"title\":\"Another Real Title\"}");
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("Another Real Title", result.Title);
        }
    }

    [Theory]
    [InlineData("malformed json not even close")]
    [InlineData("{\"no_title_field\":true}")]
    public async Task ResolveAsync_YouTube_WhenOEmbedRespondsMalformed_ResolveStillSucceeds_WithNoTitle(string body)
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    return OEmbedJsonResponse(body);
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_WhenOEmbedRequestThrows_ResolveStillSucceeds_WithNoTitle()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    throw new TaskCanceledException("simulated oEmbed timeout");
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_WhenOEmbedRespondsNonSuccessStatus_ResolveStillSucceeds_WithNoTitle()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    return new HttpResponseMessage(HttpStatusCode.InternalServerError);
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_NonYouTubeHost_WithNoTitleInHtml_NeverCallsOEmbed()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    throw new InvalidOperationException("Must never call YouTube's oEmbed for a non-YouTube host.");
                }

                return HtmlResponse("<html><head></head></html>");
            },
            out var handler, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://example.com/no-title-here");

            Assert.Null(result.Title);
            Assert.Equal(1, handler.CallCount);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_WhenOEmbedTitleIsItselfTheKnownPlaceholder_IsNotUsed()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    return OEmbedJsonResponse("{\"title\":\"YouTube\"}");
                }

                return request.Method == HttpMethod.Head
                    ? new HttpResponseMessage(HttpStatusCode.NotFound)
                    : HtmlResponse("<html><head><title>- YouTube</title></head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Null(result.Title);
        }
    }

    [Fact]
    public async Task ResolveAsync_YouTube_OEmbedTitleFallback_DoesNotAffectThumbnailResolution()
    {
        var resolver = CreateResolver(
            (request, _) =>
            {
                if (IsOEmbedRequest(request))
                {
                    return OEmbedJsonResponse("{\"title\":\"Thumbnail Coexistence Title\"}");
                }

                if (request.Method == HttpMethod.Head)
                {
                    return request.RequestUri!.AbsoluteUri.Contains("hqdefault")
                        ? new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(new byte[50_000]) }
                        : new HttpResponseMessage(HttpStatusCode.NotFound);
                }

                return HtmlResponse(
                    "<html><head><title>- YouTube</title>"
                    + "<meta property=\"og:image\" content=\"https://i.ytimg.com/vi/abc123XYZ_/maxresdefault.jpg\" />"
                    + "</head></html>");
            },
            out _, out var cache);
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.youtube.com/watch?v=abc123XYZ_");

            Assert.Equal("Thumbnail Coexistence Title", result.Title);
            Assert.Equal("https://i.ytimg.com/vi/abc123XYZ_/hqdefault.jpg", result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task ResolveAsync_CachesResult_SecondCallForSameUrlDoesNotRefetch()
    {
        var resolver = CreateResolver(
            (_, _) => HtmlResponse("<html><head><title>Cached Title</title></head></html>"),
            out var handler, out var cache);
        using (cache)
        {
            var first = await resolver.ResolveAsync("https://example.com/cache-me");
            var second = await resolver.ResolveAsync("https://example.com/cache-me");

            Assert.Equal("Cached Title", first.Title);
            Assert.Equal("Cached Title", second.Title);
            Assert.Equal(1, handler.CallCount);
        }
    }
}
