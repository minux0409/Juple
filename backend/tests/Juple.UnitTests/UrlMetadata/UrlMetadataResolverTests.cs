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
