using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Juple.Application.UrlMetadata;
using Juple.Infrastructure.UrlMetadata;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.UrlMetadata;

/// <summary>
/// TikTok metadata through TikTok's official oEmbed endpoint (TikTokOEmbedResolver, wired into
/// UrlMetadataResolver) - via a stub HttpMessageHandler, so no real network call is ever made.
/// </summary>
public sealed class TikTokOEmbedResolverTests
{
    private const string UserSuppliedUrl = "https://www.tiktok.com/@mylove_kr93/video/7681262859485023510?is_from_webapp=1&sender_device=pc";
    private const string CanonicalUrl = "https://www.tiktok.com/@mylove_kr93/video/7681262859485023510";
    private const string Thumbnail = "https://p16-sign-va.tiktokcdn.com/obj/tos-maliva-p-0068/abc~tplv-noop.image?x-expires=1760400000&x-signature=xyz";

    private sealed class StubHandler(Func<HttpRequestMessage, int, HttpResponseMessage> handler) : HttpMessageHandler
    {
        public List<Uri> Requests { get; } = [];

        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            Requests.Add(request.RequestUri!);
            return Task.FromResult(handler(request, Requests.Count));
        }
    }

    private static (UrlMetadataResolver Resolver, StubHandler Handler, MemoryCache Cache) Create(Func<HttpRequestMessage, int, HttpResponseMessage> handler)
    {
        var stub = new StubHandler(handler);
        var cache = new MemoryCache(new MemoryCacheOptions());
        return (new UrlMetadataResolver(new HttpClient(stub), cache, TimeProvider.System, NullLogger<UrlMetadataResolver>.Instance), stub, cache);
    }

    private static HttpResponseMessage Json(string json, HttpStatusCode status = HttpStatusCode.OK)
    {
        var response = new HttpResponseMessage(status) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(json)) };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("application/json");
        return response;
    }

    private static HttpResponseMessage Html(string html)
    {
        var response = new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(Encoding.UTF8.GetBytes(html)) };
        response.Content.Headers.ContentType = new MediaTypeHeaderValue("text/html");
        return response;
    }

    private static bool IsTikTokOEmbed(Uri uri) => uri.Host == "www.tiktok.com" && uri.AbsolutePath == "/oembed";

    private static string OEmbedUrlParameter(Uri uri) =>
        Uri.UnescapeDataString(uri.Query.TrimStart('?').Split('&').Single(part => part.StartsWith("url=", StringComparison.Ordinal))["url=".Length..]);

    // ---- canonicalization ----------------------------------------------------------------------

    [Theory]
    [InlineData(UserSuppliedUrl, CanonicalUrl)]
    [InlineData("https://tiktok.com/@mylove_kr93/video/7681262859485023510", CanonicalUrl)]
    [InlineData("https://m.tiktok.com/@mylove_kr93/video/7681262859485023510/", CanonicalUrl)]
    [InlineData("http://www.tiktok.com/@mylove_kr93/VIDEO/7681262859485023510#comments", CanonicalUrl)]
    [InlineData("https://www.tiktok.com/@some.user_1/photo/7400000000000000001?lang=ko", "https://www.tiktok.com/@some.user_1/photo/7400000000000000001")]
    public void TryGetCanonicalPostUrl_KeepsOnlyHandleKindAndId(string input, string expected)
    {
        Assert.True(TikTokOEmbedResolver.TryGetCanonicalPostUrl(new Uri(input), out var canonical));
        Assert.Equal(expected, canonical!.ToString());
    }

    [Theory]
    [InlineData("https://www.tiktok.com/@mylove_kr93")]
    [InlineData("https://www.tiktok.com/video/7681262859485023510")]
    [InlineData("https://www.tiktok.com/@mylove_kr93/video/notanumber")]
    [InlineData("https://www.tiktok.com/@bad<handle>/video/7681262859485023510")]
    [InlineData("https://vm.tiktok.com/ZSabc123/")]
    [InlineData("https://tiktok.com.evil.example/@a/video/7681262859485023510")]
    [InlineData("https://evil.example/@a/video/7681262859485023510")]
    [InlineData("ftp://www.tiktok.com/@a/video/7681262859485023510")]
    public void TryGetCanonicalPostUrl_RejectsAnythingElse(string input)
    {
        Assert.False(TikTokOEmbedResolver.TryGetCanonicalPostUrl(new Uri(input), out _));
    }

    // ---- resolve -------------------------------------------------------------------------------

    [Fact]
    public async Task Resolve_UserSuppliedUrl_AsksOEmbedOnce_WithTheCanonicalUrl_AndNeverFetchesThePage()
    {
        var (resolver, handler, cache) = Create((request, _) => IsTikTokOEmbed(request.RequestUri!)
            ? Json($$"""{"version":"1.0","type":"video","title":"  Real   caption #tag ","author_name":"x","thumbnail_url":"{{Thumbnail}}","html":"<blockquote>…</blockquote><script src=\"https://www.tiktok.com/embed.js\"></script>"}""")
            : throw new InvalidOperationException("the post page must not be fetched"));
        using (cache)
        {
            var result = await resolver.ResolveAsync(UserSuppliedUrl);

            Assert.Equal("Real caption #tag", result.Title);
            Assert.Equal(UrlMetadataSource.TikTokOEmbed, result.Source);
            Assert.Equal(Thumbnail, result.PreviewImageUrl);
            var request = Assert.Single(handler.Requests);
            Assert.Equal(CanonicalUrl, OEmbedUrlParameter(request));
        }
    }

    [Fact]
    public async Task Resolve_PlaceholderTitle_IsNoTitle_ButTheThumbnailStays()
    {
        var (resolver, _, cache) = Create((_, _) => Json($$"""{"title":"TikTok - Make Your Day","thumbnail_url":"{{Thumbnail}}"}"""));
        using (cache)
        {
            var result = await resolver.ResolveAsync(CanonicalUrl);
            Assert.Null(result.Title);
            Assert.Null(result.Source);
            Assert.Equal(Thumbnail, result.PreviewImageUrl);
        }
    }

    [Theory]
    [InlineData(HttpStatusCode.TooManyRequests)]
    [InlineData(HttpStatusCode.ServiceUnavailable)]
    [InlineData(HttpStatusCode.NotFound)]
    [InlineData(HttpStatusCode.Found)]
    public async Task Resolve_NonSuccess_FailsOpen_WithOneRequest_AndNoRetry(HttpStatusCode status)
    {
        var (resolver, handler, cache) = Create((_, _) =>
        {
            var response = new HttpResponseMessage(status) { Content = new StringContent("ratelimit triggered") };
            if (status == HttpStatusCode.Found)
            {
                response.Headers.Location = new Uri("https://www.tiktok.com/login");
            }

            return response;
        });
        using (cache)
        {
            var result = await resolver.ResolveAsync(UserSuppliedUrl);
            Assert.Null(result.Title);
            Assert.Null(result.PreviewImageUrl);
            Assert.Single(handler.Requests);
        }
    }

    [Fact]
    public async Task Resolve_Timeout_FailsOpen()
    {
        var (resolver, handler, cache) = Create((_, _) => throw new TaskCanceledException("timed out"));
        using (cache)
        {
            var result = await resolver.ResolveAsync(CanonicalUrl);
            Assert.Null(result.Title);
            Assert.Null(result.PreviewImageUrl);
            Assert.Single(handler.Requests);
        }
    }

    [Theory]
    [InlineData("not json")]
    [InlineData("[1,2]")]
    [InlineData("""{"title":null,"thumbnail_url":5}""")]
    public async Task Resolve_MalformedAnswer_IsNoMetadata(string body)
    {
        var (resolver, _, cache) = Create((_, _) => Json(body));
        using (cache)
        {
            var result = await resolver.ResolveAsync(CanonicalUrl);
            Assert.Null(result.Title);
            Assert.Null(result.PreviewImageUrl);
        }
    }

    [Theory]
    [InlineData("https://evil.example/thumb.jpg")]
    [InlineData("http://p16-sign-va.tiktokcdn.com/obj/x.image")]
    [InlineData("https://p16-sign-va.tiktokcdn.com.evil.example/x.image")]
    [InlineData("javascript:alert(1)")]
    public async Task Resolve_ThumbnailOutsideTikTokCdn_IsDropped_TitleKept(string thumbnail)
    {
        var (resolver, _, cache) = Create((_, _) => Json($$"""{"title":"Caption","thumbnail_url":"{{thumbnail}}"}"""));
        using (cache)
        {
            var result = await resolver.ResolveAsync(CanonicalUrl);
            Assert.Equal("Caption", result.Title);
            Assert.Null(result.PreviewImageUrl);
        }
    }

    [Fact]
    public async Task Resolve_LongCaption_IsCappedLikeHtmlTitles()
    {
        var (resolver, _, cache) = Create((_, _) => Json($$"""{"title":"{{new string('a', 900)}}","thumbnail_url":"{{Thumbnail}}"}"""));
        using (cache)
        {
            Assert.Equal(300, (await resolver.ResolveAsync(CanonicalUrl)).Title!.Length);
        }
    }

    [Fact]
    public async Task Resolve_ShortLink_FollowsTheGuardedRedirect_ThenAsksOEmbedWithTheCanonicalUrl()
    {
        var (resolver, handler, cache) = Create((request, count) => count == 1
            ? new HttpResponseMessage(HttpStatusCode.MovedPermanently)
            {
                Headers = { Location = new Uri("https://www.tiktok.com/@mylove_kr93/video/7681262859485023510?_r=1&_t=ZS-abc") },
            }
            : IsTikTokOEmbed(request.RequestUri!)
                ? Json($$"""{"title":"Caption","thumbnail_url":"{{Thumbnail}}"}""")
                : throw new InvalidOperationException("the post page must not be fetched"));
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://vm.tiktok.com/ZSabc123/");
            Assert.Equal("Caption", result.Title);
            Assert.Equal(2, handler.Requests.Count);
            Assert.Equal("vm.tiktok.com", handler.Requests[0].Host);
            Assert.Equal(CanonicalUrl, OEmbedUrlParameter(handler.Requests[1]));
        }
    }

    [Fact]
    public async Task Resolve_ShortLinkLeadingElsewhere_IsAnOrdinaryPage_NeverOEmbed()
    {
        var (resolver, handler, cache) = Create((request, count) => count == 1
            ? new HttpResponseMessage(HttpStatusCode.Found) { Headers = { Location = new Uri("https://example.com/landing") } }
            : Html("<html><head><title>Landing</title></head></html>"));
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://vt.tiktok.com/ZSxyz/");
            Assert.Equal("Landing", result.Title);
            Assert.DoesNotContain(handler.Requests, IsTikTokOEmbed);
        }
    }

    [Fact]
    public async Task Resolve_TikTokNonPostPage_AppShellTitleIsNoTitle()
    {
        var (resolver, handler, cache) = Create((_, _) =>
            Html("<html><head><meta property=\"og:title\" content=\"TikTok - Make Your Day\" /><title>TikTok - Make Your Day</title></head></html>"));
        using (cache)
        {
            var result = await resolver.ResolveAsync("https://www.tiktok.com/@mylove_kr93");
            Assert.Null(result.Title);
            Assert.DoesNotContain(handler.Requests, IsTikTokOEmbed);
        }
    }

    [Fact]
    public async Task Resolve_OtherSites_NeverReachTikTok()
    {
        var (resolver, handler, cache) = Create((_, _) => Html("<html><head><meta property=\"og:title\" content=\"TikTok - Make Your Day\" /></head></html>"));
        using (cache)
        {
            // The TikTok placeholder filter is TikTok-only: another site may really be titled like that.
            Assert.Equal("TikTok - Make Your Day", (await resolver.ResolveAsync("https://example.com/a")).Title);
            Assert.DoesNotContain(handler.Requests, IsTikTokOEmbed);
        }
    }
}
