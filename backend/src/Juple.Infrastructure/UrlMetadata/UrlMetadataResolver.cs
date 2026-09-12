using System.Net;
using System.Text;
using Juple.Application.UrlMetadata;
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
/// caller's own save flow is never affected by this. See UrlMetadataOperationException.
/// </summary>
public sealed class UrlMetadataResolver(
    HttpClient httpClient,
    IMemoryCache memoryCache,
    TimeProvider timeProvider,
    ILogger<UrlMetadataResolver> logger) : IUrlMetadataResolver
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
        var none = new UrlMetadataResult(null, null);
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
        var lastAttemptedHost = initialUri.Host;

        using var budgetCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        budgetCts.CancelAfter(TotalRequestBudget);

        try
        {
            var currentUri = initialUri;
            while (true)
            {
                if (!IsAllowedRequestUri(currentUri))
                {
                    throw new UrlMetadataOperationException("disallowed_scheme_or_port");
                }

                lastAttemptedHost = currentUri.Host;

                using var request = new HttpRequestMessage(HttpMethod.Get, currentUri);
                using var response = await httpClient.SendAsync(
                    request, HttpCompletionOption.ResponseHeadersRead, budgetCts.Token);

                if (IsRedirectStatus(response.StatusCode))
                {
                    var location = response.Headers.Location
                        ?? throw new UrlMetadataOperationException("redirect_missing_location");

                    redirectCount++;
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
                var (title, source) = await HtmlTitleExtractor.ExtractAsync(html, budgetCts.Token);
                result = new UrlMetadataResult(title, source);
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
        LogOutcome(lastAttemptedHost, result, failureCategory, redirectCount, elapsedMs);

        memoryCache.Set(cacheKey, result, CacheEntryOptions);
        return result;
    }

    /// <summary>Only http/https on their default port (80/443) - see ResolveUrlMetadataService.ValidateUrl for the same rule at the request-shape level; this re-checks it per redirect hop.</summary>
    private static bool IsAllowedRequestUri(Uri uri) =>
        (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps) && uri.IsDefaultPort;

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
            && (bytesRead = await stream.ReadAsync(buffer, cancellationToken)) > 0)
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
    /// Privacy-safe by construction: hostname only (never full URL/path/query), never the title
    /// text, never response bytes - see docs' logging policy for this feature.
    /// </summary>
    private void LogOutcome(
        string hostname, UrlMetadataResult result, string? failureCategory, int redirectCount, double elapsedMs)
    {
        if (failureCategory is not null)
        {
            logger.LogInformation(
                "URL metadata resolve failed. Host={Hostname} Category={FailureCategory} RedirectCount={RedirectCount} ElapsedMs={ElapsedMs}",
                hostname, failureCategory, redirectCount, elapsedMs);
            return;
        }

        logger.LogInformation(
            "URL metadata resolve completed. Host={Hostname} Found={Found} Source={Source} RedirectCount={RedirectCount} ElapsedMs={ElapsedMs}",
            hostname, result.Title is not null, result.Source, redirectCount, elapsedMs);
    }
}
