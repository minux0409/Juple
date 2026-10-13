using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Title and thumbnail for a TikTok post from TikTok's own public, unauthenticated oEmbed endpoint
/// (https://www.tiktok.com/oembed) - the documented embed-preview API, the same role
/// YouTubeOEmbedTitleResolver plays for YouTube. A TikTok post page fetched as HTML only ever gives
/// the app shell ("TikTok - Make Your Day", no image), so a post URL goes straight here instead.
///
/// Only two fields are used: "title" and "thumbnail_url". The embed "html" (a script tag) is never
/// read, stored or rendered, and the page's own embedded JSON is never parsed. Nothing is guessed:
/// a missing / placeholder title is null, and so is a thumbnail that is not an https URL on TikTok's
/// own image CDN.
///
/// SSRF: the request always goes to this one fixed host and path; the post URL is only the "url"
/// query value, rebuilt from the parsed handle and numeric id (never the user's raw string). The
/// shared SSRF-hardened HttpClient (DependencyInjection.AddUrlMetadataResolver) does the connection
/// guarding unchanged, and has AllowAutoRedirect=false - so a redirect here is simply a failure.
///
/// Fail-open: 429 / 503 / any other non-2xx, a timeout, an oversized or malformed body all mean "no
/// metadata" - never an exception, and never a retry loop (a caller's save is not affected).
///
/// The thumbnail is a signed CDN URL that expires (its x-expires query value - typically days). It
/// is stored like any other automatic preview image URL; it is not copied into Juple storage.
/// </summary>
public static partial class TikTokOEmbedResolver
{
    private const long MaxResponseBytes = 64 * 1024;
    private const int MaxTitleLength = 300; // the same cap as HtmlTitleExtractor
    private const int MaxThumbnailUrlLength = 4096; // the PreviewImageUrl column / SetItemPreviewImageService limit
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(4);

    /// <summary>TikTok's image CDN families that serve oEmbed thumbnails (regional variants included).</summary>
    private static readonly string[] ThumbnailHostSuffixes = [".tiktokcdn.com", ".tiktokcdn-us.com", ".tiktokcdn-eu.com"];

    public sealed record Result(string? Title, string? ThumbnailUrl, string Outcome);

    /// <summary>tiktok.com and its subdomains (www, m, vm, vt).</summary>
    public static bool IsTikTokHost(string host) =>
        host.Equals("tiktok.com", StringComparison.OrdinalIgnoreCase)
        || host.EndsWith(".tiktok.com", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// A post URL - /@handle/video/{id} or /@handle/photo/{id} on tiktok.com, www.tiktok.com or
    /// m.tiktok.com - as its canonical form https://www.tiktok.com/@handle/{video|photo}/{id}: no query
    /// (is_from_webapp, sender_device and other tracking parameters), no fragment. A short link
    /// (vm. / vt.tiktok.com) is not a post URL: it is followed through UrlMetadataResolver's own
    /// guarded redirect loop and becomes one there.
    /// </summary>
    public static bool TryGetCanonicalPostUrl(Uri uri, out Uri? canonical)
    {
        canonical = null;
        if ((uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp)
            || !(uri.Host.Equals("tiktok.com", StringComparison.OrdinalIgnoreCase)
                || uri.Host.Equals("www.tiktok.com", StringComparison.OrdinalIgnoreCase)
                || uri.Host.Equals("m.tiktok.com", StringComparison.OrdinalIgnoreCase)))
        {
            return false;
        }

        var match = PostPathRegex().Match(uri.AbsolutePath);
        if (!match.Success)
        {
            return false;
        }

        canonical = new Uri($"https://www.tiktok.com/@{match.Groups["handle"].Value}/{match.Groups["kind"].Value.ToLowerInvariant()}/{match.Groups["id"].Value}");
        return true;
    }

    public static async Task<Result> ResolveAsync(HttpClient httpClient, Uri canonicalPostUri, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(RequestTimeout);

        try
        {
            var requestUri = new Uri("https://www.tiktok.com/oembed?url=" + Uri.EscapeDataString(canonicalPostUri.ToString()));
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
            using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                return new Result(null, null, response.StatusCode == HttpStatusCode.TooManyRequests ? "rate_limited" : $"http_status_{(int)response.StatusCode}");
            }

            var json = await ReadBoundedJsonAsync(response, timeoutCts.Token);
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return new Result(null, null, "invalid_json");
            }

            var title = NormalizeTitle(StringProperty(root, "title"));
            var thumbnailUrl = AcceptThumbnailUrl(StringProperty(root, "thumbnail_url"));
            return new Result(title, thumbnailUrl, title is null && thumbnailUrl is null ? "no_metadata" : "ok");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return new Result(null, null, "timeout");
        }
        catch (Exception exception) when (exception is HttpRequestException or JsonException or UriFormatException)
        {
            return new Result(null, null, exception is JsonException ? "invalid_json" : "network_error");
        }
    }

    /// <summary>
    /// TikTok's own app-shell titles - what a post page (or an oEmbed answer for nothing in particular)
    /// says when it says nothing about the post. Host-gated by the callers (TikTok only), the same way
    /// HtmlTitleExtractor treats YouTube's "- YouTube".
    /// </summary>
    public static bool IsKnownPlaceholderTitle(string normalizedTitle)
    {
        var lower = normalizedTitle.Trim().ToLowerInvariant();
        return lower is "tiktok" or "tiktok - make your day" or "make your day" or "tiktok | make your day";
    }

    private static string? StringProperty(JsonElement root, string name) =>
        root.TryGetProperty(name, out var element) && element.ValueKind == JsonValueKind.String ? element.GetString() : null;

    private static string? NormalizeTitle(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var collapsed = WhitespaceRegex().Replace(raw.Trim(), " ").Trim();
        if (collapsed.Length == 0 || IsKnownPlaceholderTitle(collapsed))
        {
            return null;
        }

        return collapsed.Length > MaxTitleLength ? collapsed[..MaxTitleLength].TrimEnd() : collapsed;
    }

    /// <summary>An https URL on TikTok's image CDN, within the stored length - anything else is no thumbnail.</summary>
    private static string? AcceptThumbnailUrl(string? raw)
    {
        var value = raw?.Trim();
        if (string.IsNullOrEmpty(value)
            || value.Length > MaxThumbnailUrlLength
            || !Uri.TryCreate(value, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !uri.IsDefaultPort
            || !ThumbnailHostSuffixes.Any(suffix => uri.Host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase)))
        {
            return null;
        }

        return value;
    }

    private static async Task<string> ReadBoundedJsonAsync(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var buffered = new MemoryStream();
        var buffer = new byte[4096];
        int bytesRead;
        while (buffered.Length < MaxResponseBytes
            && (bytesRead = await stream.ReadAsync(
                buffer.AsMemory(0, (int)Math.Min(buffer.Length, MaxResponseBytes - buffered.Length)), cancellationToken)) > 0)
        {
            buffered.Write(buffer, 0, bytesRead);
        }

        return Encoding.UTF8.GetString(buffered.ToArray());
    }

    /// <summary>/@handle/video/{id} or /@handle/photo/{id}, an optional trailing slash. Handles are letters, digits, '_' and '.'.</summary>
    [GeneratedRegex(@"^/@(?<handle>[A-Za-z0-9._]{1,64})/(?<kind>video|photo)/(?<id>\d{8,25})/?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex PostPathRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
