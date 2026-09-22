using System.Net;
using System.Text;
using Juple.Application.UrlMetadata;
using Juple.Application.UrlSafety;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Fetches a user-supplied URL server-side and extracts a title (og:title -&gt; twitter:title -&gt;
/// &lt;title&gt;) - see docs/architecture.md's "AI"/enrichment stance and the SSRF hardening this
/// exists to enforce. The actual host-safety check (scheme/port/DNS/IP) happens inside the
/// injected HttpClient's SocketsHttpHandler.ConnectCallback - see
/// DependencyInjection.AddUrlMetadataResolver - so every redirect hop goes through the same guard
/// as the initial request; this class only adds the request-level policy AddHttpClient's
/// ConnectCallback alone cannot express: no auto-redirect (so hops can be counted/capped and
/// re-validated one at a time instead of followed blindly), a bounded overall time/byte budget,
/// and an HTML-only content-type gate.
///
/// Always best-effort - every expected failure (SSRF-blocked, timeout, oversized, wrong content
/// type, no title found) resolves to UrlMetadataResult(null, null) rather than throwing, so a
/// caller's own save flow is unaffected by fetch failures. Redirect reputation failures instead
/// throw UrlSafetyCheckException and must stop saving. See UrlMetadataOperationException.
/// </summary>
public sealed class UrlMetadataResolver(
    HttpClient httpClient,
    IMemoryCache memoryCache,
    TimeProvider timeProvider,
    ILogger<UrlMetadataResolver> logger,
    IUrlSafetyChecker urlSafetyChecker) : IUrlMetadataResolver
{
    private const int MaxRedirects = 5;
    private const long MaxResponseBytes = 1024 * 1024; // 1 MB - enough for metadata typically near the top of <head>.
    private static readonly TimeSpan TotalRequestBudget = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan CacheDuration = TimeSpan.FromMinutes(10);

    private static readonly MemoryCacheEntryOptions CacheEntryOptions = new()
    {
        AbsoluteExpirationRelativeToNow = CacheDuration,
        Size = 1,
    };

    public async Task<UrlMetadataResult> ResolveAsync(string url, CancellationToken cancellationToken = default)
    {
        var none = new UrlMetadataResult(null, null, null);
        if (!Uri.TryCreate(url, UriKind.Absolute, out var initialUri))
        {
            return none;
        }

        var cacheKey = $"UrlMetadata:{initialUri}";
        if (memoryCache.TryGetValue(cacheKey, out UrlMetadataResult? cached) && cached is not null)
        {
            return cached;
        }

        var startTimestamp = timeProvider.GetTimestamp();
        var result = none;
        string? failureCategory = null;
        var redirectCount = 0;
        var redirectChainComplete = false;
        var lastAttemptedHost = initialUri.Host;
        UrlMetadataImageSource? imageSourceForDiagnostics = null;
        string? youTubeImageVariantForDiagnostics = null;

        using var budgetCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budgetCts.CancelAfter(TotalRequestBudget);

        try
        {
            var currentUri = initialUri;
            var visited = new HashSet<Uri>();
            // Carries any Set-Cookie a hop issues to a later hop's request within this one
            // ResolveAsync call only - a fresh, empty container per call, never persisted past
            // this method and never shared across calls/users (the injected HttpClient itself
            // still has UseCookies=false, so nothing here creates a cross-request cookie jar; see
            // AddUrlMetadataResolver's own remarks). A real System.Net.CookieContainer, not a flat
            // name/value map - SetCookies/GetCookieHeader below apply RFC 6265 Domain/Path/Secure/
            // Expires scoping per hop's own URI, so a cookie set by one host on the redirect chain
            // is never forwarded to a different, unrelated host later in the same chain (see this
            // class's own test suite for the cross-origin cases this specifically guards against).
            // Exists because disabling HttpClient's automatic redirect handling (see this class's
            // own remarks on why - hop counting/re-validation) also disabled the cookie continuity
            // a browser completing the same redirect chain gets for free: a real production
            // comparison (Azure Dev container logs, 2026-09) showed Instagram consistently serving
            // full post og:tags when no redirect was needed (RedirectCount=0) but a generic
            // interstitial page once our own hop-by-hop fetch had to follow one (RedirectCount=1,
            // 6/6 observed), which is exactly the signature of a server that expects the
            // Set-Cookie from its own redirect response to come back on the very next request.
            // Restoring that within a single resolve operation is standard single-navigation HTTP
            // behavior (what AllowAutoRedirect=true would already do automatically) - not a
            // persistent session, a login, or a CAPTCHA/bot-detection bypass.
            var cookieContainer = new CookieContainer();

            while (true)
            {
                if (!visited.Add(currentUri))
                    throw new UrlMetadataOperationException("redirect_loop");
                if (!IsAllowedRequestUri(currentUri))
                {
                    throw new UrlMetadataOperationException("disallowed_scheme_or_port");
                }

                lastAttemptedHost = currentUri.Host;

                if (redirectCount > 0)
                {
                    // A safe short link can redirect to a known threat. Do not turn a failed
                    // redirect reputation check into an ordinary best-effort metadata failure.
                    UrlSafetyResult safety;
                    try
                    {
                        safety = await urlSafetyChecker.CheckAsync(currentUri.AbsoluteUri, budgetCts.Token);
                    }
                    catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
                    {
                        safety = UrlSafetyResult.Unavailable;
                    }
                    UrlSafetyCheckException.ThrowIfNotAllowed(safety);
                }

                using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
                var cookieHeader = cookieContainer.GetCookieHeader(currentUri);
                if (!string.IsNullOrEmpty(cookieHeader))
                {
                    request.Headers.TryAddWithoutValidation("Cookie", cookieHeader);
                }

                using var response = await httpClient.SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, budgetCts.Token);

                if (response.Headers.TryGetValues("Set-Cookie", out var setCookieValues))
                {
                    foreach (var setCookie in setCookieValues)
                    {
                        try
                        {
                            // Scoped against currentUri (the URI that actually issued this
                            // Set-Cookie) - CookieContainer itself enforces that a Domain
                            // attribute must be the issuing host or a valid parent of it (RFC
                            // 6265 domain-matching), and defaults to a host-only cookie when no
                            // Domain is given at all, so a malicious/misconfigured redirect target
                            // can never plant a cookie that CookieContainer would later hand to a
                            // different, unrelated host.
                            cookieContainer.SetCookies(currentUri, setCookie);
                        }
                        catch (CookieException)
                        {
                            // Malformed Set-Cookie (invalid Domain scope, unparseable attribute,
                            // ...) - best-effort only, exactly like every other piece of metadata
                            // extraction in this class; never let a bad response header fail the
                            // whole resolve.
                        }
                    }
                }

                if (IsRedirectStatus(response.StatusCode))
                {
                    redirectCount++;
                    var location = response.Headers.Location
                        ?? throw new UrlMetadataOperationException("redirect_missing_location");

                    if (redirectCount > MaxRedirects)
                    {
                        throw new UrlMetadataOperationException("redirect_limit_exceeded");
                    }

                    // A new HttpRequestMessage.SendAsync for a different authority opens a new
                    // connection, which re-invokes ConnectCallback - so this loop re-validates
                    // scheme/port/DNS/IP on every hop for free rather than needing bespoke logic
                    // here (see the class remarks).
                    currentUri = location.IsAbsoluteUri ? location : new Uri(currentUri, location);
                    continue;
                }

                redirectChainComplete = true;
                if (!response.IsSuccessStatusCode)
                {
                    throw new UrlMetadataOperationException($"http_status_{(int)response.StatusCode}");
                }

                var mediaType = response.Content.Headers.ContentType?.MediaType;
                if (mediaType is null || !IsHtmlMediaType(mediaType))
                {
                    throw new UrlMetadataOperationException("unsupported_content_type");
                }

                if (response.Content.Headers.ContentLength is { } contentLength
                    && contentLength > MaxResponseBytes)
                {
                    throw new UrlMetadataOperationException("response_too_large");
                }

                var html = await ReadBoundedHtmlAsync(response, budgetCts.Token);
                var (title, source, previewImageUrl, previewImageSource) =
                    await HtmlTitleExtractor.ExtractAsync(html, budgetCts.Token, currentUri.Host);

                // Instagram's own generic/login-wall/interstitial shell page (served instead of
                // the real post - see this class's own remarks on redirect/cookie continuity,
                // which turned out NOT to be sufficient to avoid it) still declares a
                // syntactically valid og:image: Instagram's own static UI-asset icon, always
                // served from static.cdninstagram.com - never the real post's photo (real
                // post/reel media comes from a different subdomain family entirely,
                // e.g. scontent.cdninstagram.com/*.fbcdn.net). Confirmed via real Azure Dev
                // production data (2026-09): every observed PreviewImageUrl saved from an
                // Instagram share so far resolved to exactly this host. Persisting it would be an
                // actively wrong, misleading preview - not "no data", a WRONG one - so it is
                // rejected the same way a missing image is, never stored. This is a structural
                // host check against Instagram's own stable, public CDN topology (the same kind
                // of platform-aware check YouTubeThumbnailResolver already does for i.ytimg.com),
                // not a guess about any single response's content, and it never touches
                // InstagramMetadataNormalizer's username/caption parsing at all.
                if (previewImageUrl is not null
                    && InstagramMetadataNormalizer.IsInstagramHost(currentUri.Host)
                    && Uri.TryCreate(previewImageUrl, UriKind.Absolute, out var previewImageUri)
                    && previewImageUri.Host.Equals("static.cdninstagram.com", StringComparison.OrdinalIgnoreCase))
                {
                    previewImageUrl = null;
                    previewImageSource = null;
                }

                // A YouTube og:image candidate unconditionally names maxresdefault.jpg even when
                // that specific resolution was never generated for the video (see
                // YouTubeThumbnailResolver's own remarks) - verify it actually exists (falling back
                // through lower qualities that always exist) before ever persisting it, rather than
                // storing a URL that will 404 for the mobile client. A no-op for every non-YouTube
                // image URL.
                if (previewImageUrl is { } extractedImageUrl)
                {
                    (previewImageUrl, youTubeImageVariantForDiagnostics) =
                        await YouTubeThumbnailResolver.ResolveExistingThumbnailAsync(
                            httpClient, extractedImageUrl, budgetCts.Token);
                }
                else if (YouTubeThumbnailResolver.TryExtractVideoIdFromPageUrl(currentUri, out var videoId))
                {
                    // The fetched HTML had no og:image/twitter:image/JSON-LD image at all for
                    // HtmlTitleExtractor to hand us a candidate from (observed on Azure Dev: the
                    // response's <title> parses fine, but its whole og: meta block is missing) -
                    // that must not mean thumbnail enrichment is skipped outright. The video ID
                    // itself comes from the page URL's own structure, always available regardless
                    // of what the fetched HTML did or didn't contain, so the exact same
                    // existence-verified quality-fallback this class already uses for an
                    // HTML-derived candidate can still run from it.
                    (previewImageUrl, youTubeImageVariantForDiagnostics) =
                        await YouTubeThumbnailResolver.ResolveExistingThumbnailForVideoIdAsync(
                            httpClient, videoId!, budgetCts.Token);
                }

                result = new UrlMetadataResult(title, source, previewImageUrl);
                imageSourceForDiagnostics = previewImageSource;
                break;
            }
        }
        catch (UrlMetadataOperationException exception)
        {
            failureCategory = exception.Category;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            failureCategory = "timeout";
        }
        catch (HttpRequestException)
        {
            failureCategory = "network_error";
        }

        var elapsedMs = timeProvider.GetElapsedTime(startTimestamp).TotalMilliseconds;
        LogOutcome(
            lastAttemptedHost, result, imageSourceForDiagnostics, youTubeImageVariantForDiagnostics,
            failureCategory, redirectCount, elapsedMs);

        // An unfinished chain (limit, loop, blocked host, timeout) cannot approve a link whose
        // eventual destination was never checked. Never persist it as an ordinary metadata miss.
        if (redirectCount > 0 && !redirectChainComplete)
            UrlSafetyCheckException.ThrowIfNotAllowed(UrlSafetyResult.Unavailable);

        // A cached redirect chain must not bypass destination reputation checks on later saves.
        if (redirectCount == 0)
            memoryCache.Set(cacheKey, result, CacheEntryOptions);
        return result;
    }

    /// <summary>Only http/https on their default port (80/443) - see ResolveUrlMetadataService.ValidateUrl for the same rule at the request-shape level; this re-checks it per redirect hop.</summary>
    private static bool IsAllowedRequestUri(Uri uri) =>
        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)
        && !string.IsNullOrEmpty(uri.Host) && uri.IsDefaultPort;

    private static bool IsRedirectStatus(HttpStatusCode status) =>
        status is HttpStatusCode.MovedPermanently or HttpStatusCode.Found or HttpStatusCode.SeeOther
            or HttpStatusCode.TemporaryRedirect or HttpStatusCode.PermanentRedirect;

    private static bool IsHtmlMediaType(string mediaType) =>
        mediaType.Equals("text/html", StringComparison.OrdinalIgnoreCase)
        || mediaType.Equals("application/xhtml+xml", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Reads up to MaxResponseBytes and stops - the remainder of a larger body is never
    /// downloaded. Parses whatever was captured rather than discarding it outright: metadata tags
    /// are conventionally near the top of &lt;head&gt;, so a truncated read still usually contains
    /// them even for a large page.
    /// </summary>
    private static async Task<string> ReadBoundedHtmlAsync(
        HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffered = new MemoryStream();
        var buffer = new byte[8192];
        int bytesRead;
        while (buffered.Length < MaxResponseBytes
            && (bytesRead = await stream.ReadAsync(
                buffer.AsMemory(0, (int)Math.Min(buffer.Length, MaxResponseBytes - buffered.Length)), cancellationToken)) > 0)
        {
            var remaining = MaxResponseBytes - buffered.Length;
            var toWrite = (int)Math.Min(bytesRead, remaining);
            buffered.Write(buffer, 0, toWrite);
        }

        var encoding = ResolveEncoding(response.Content.Headers.ContentType?.CharSet);
        return encoding.GetString(buffered.ToArray());
    }

    private static Encoding ResolveEncoding(string? charSet)
    {
        if (string.IsNullOrWhiteSpace(charSet))
        {
            return Encoding.UTF8;
        }

        try
        {
            return Encoding.GetEncoding(charSet);
        }
        catch (ArgumentException)
        {
            return Encoding.UTF8;
        }
    }

    /// <summary>
    /// Privacy-safe by construction: hostname only (never full URL/path/query), never the title or
    /// image URL text, never response bytes - see docs' logging policy for this feature.
    /// ImageFound/ImageSource exist specifically to diagnose reports like "this Instagram post has
    /// no preview image" without ever logging content: they distinguish "metadata genuinely had no
    /// image" (ImageFound=false) from a persistence/render problem further down the pipeline, which
    /// must show up as a real PreviewImageUrl in the DB/API despite the mobile UI not displaying it.
    /// YouTubeImageVariant is null for every non-YouTube image (nothing to verify) - when present,
    /// it names which quality (see YouTubeThumbnailResolver) was actually confirmed to exist,
    /// distinguishing "maxres worked as-is" from "had to fall back to a lower quality".
    /// </summary>
    private void LogOutcome(
        string hostname,
        UrlMetadataResult result,
        UrlMetadataImageSource? imageSource,
        string? youTubeImageVariant,
        string? failureCategory,
        int redirectCount,
        double elapsedMs)
    {
        if (failureCategory is not null)
        {
            logger.LogInformation(
                "URL metadata resolve failed. Host={Hostname} Category={FailureCategory} RedirectCount={RedirectCount} ElapsedMs={ElapsedMs}",
                hostname, failureCategory, redirectCount, elapsedMs);
            return;
        }

        logger.LogInformation(
            "URL metadata resolve completed. Host={Hostname} Found={Found} Source={Source} ImageFound={ImageFound} ImageSource={ImageSource} YouTubeImageVariant={YouTubeImageVariant} RedirectCount={RedirectCount} ElapsedMs={ElapsedMs}",
            hostname, result.Title is not null, result.Source,
            result.PreviewImageUrl is not null, imageSource, youTubeImageVariant, redirectCount, elapsedMs);
    }
}
