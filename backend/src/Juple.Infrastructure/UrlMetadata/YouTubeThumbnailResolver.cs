using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// YouTube's own og:image meta tag unconditionally advertises
/// "https://i.ytimg.com/vi/{videoId}/maxresdefault.jpg" regardless of whether that specific
/// resolution was ever actually generated for the video - i.ytimg.com returns a real HTTP 404 (not
/// a placeholder image) for a quality that doesn't exist, which is common for older/lower-source-
/// resolution videos. Left unverified, that 404 URL would still get extracted and persisted as
/// PreviewImageUrl, and the mobile client's fail-safe "hide on load error" behavior would then just
/// silently show no thumbnail at all - indistinguishable from "no image in metadata" without this
/// check. hqdefault/mqdefault/default, by contrast, are generated for every video that has a
/// thumbnail at all, so falling back through them (never past them) reliably finds a working image
/// without ever guessing a URL that was never confirmed to exist - see the "실제 존재 여부를
/// 확인하지 않고 무조건 maxres URL을 저장하는 방식 금지" requirement this exists to satisfy.
/// </summary>
public static partial class YouTubeThumbnailResolver
{
    // Highest quality first - only ever moves to a lower quality when the current one is confirmed
    // not to exist, never skips ahead speculatively.
    private static readonly string[] QualityFallbackOrder =
        ["maxresdefault", "sddefault", "hqdefault", "mqdefault", "default"];

    /// <summary>
    /// A real thumbnail is a photographic JPEG, never a tiny few-hundred-byte file - this is a
    /// defensive floor in case i.ytimg.com ever serves a small placeholder image with a 200 status
    /// for a missing quality instead of a 404 (not observed in practice, but cheap to guard against
    /// rather than assume).
    /// </summary>
    private const int MinPlausibleThumbnailBytes = 1000;

    /// <summary>
    /// Verifies the given candidate image URL - if it isn't a per-video i.ytimg.com thumbnail URL
    /// at all (some other CDN/path), it is returned completely unchanged and Variant is null, since
    /// this resolver only ever touches YouTube's own thumbnail CDN. Otherwise, starting from
    /// whichever quality the candidate itself named, walks down QualityFallbackOrder until one is
    /// confirmed to exist (HTTP 200, plausibly-sized), returning that URL and the quality name used
    /// for diagnostics; returns (null, null) if literally none of them exist (the video genuinely
    /// has no usable thumbnail - never guessed, never fabricated).
    /// </summary>
    public static async Task<(string? Url, string? Variant)> ResolveExistingThumbnailAsync(
        HttpClient httpClient, string candidateImageUrl, CancellationToken cancellationToken)
    {
        var match = YtimgThumbnailUrlRegex().Match(candidateImageUrl);
        if (!match.Success)
        {
            return (candidateImageUrl, null);
        }

        return await ResolveExistingThumbnailForVideoAsync(
            httpClient, match.Groups["videoId"].Value, match.Groups["quality"].Value, cancellationToken);
    }

    /// <summary>
    /// Same quality-fallback verification as ResolveExistingThumbnailAsync, but starting from a
    /// video ID directly rather than an already-extracted i.ytimg.com candidate URL - for when the
    /// fetched page's HTML had no og:image/twitter:image/JSON-LD image at all to extract one from
    /// in the first place (observed on Azure Dev: the response's &lt;title&gt; parses fine but its
    /// og: meta block is absent, so HtmlTitleExtractor's own image extraction never runs), which
    /// must not mean thumbnail enrichment is skipped entirely - see
    /// TryExtractVideoIdFromPageUrl/UrlMetadataResolver's own remarks. Always starts from the
    /// highest quality (maxresdefault), exactly like a normal og:image candidate would.
    /// </summary>
    public static Task<(string? Url, string? Variant)> ResolveExistingThumbnailForVideoIdAsync(
        HttpClient httpClient, string videoId, CancellationToken cancellationToken) =>
        ResolveExistingThumbnailForVideoAsync(httpClient, videoId, QualityFallbackOrder[0], cancellationToken);

    private static async Task<(string? Url, string? Variant)> ResolveExistingThumbnailForVideoAsync(
        HttpClient httpClient, string videoId, string startingQuality, CancellationToken cancellationToken)
    {
        var startIndex = Array.IndexOf(QualityFallbackOrder, startingQuality.ToLowerInvariant());
        if (startIndex < 0)
        {
            startIndex = 0;
        }

        for (var i = startIndex; i < QualityFallbackOrder.Length; i++)
        {
            var quality = QualityFallbackOrder[i];
            var candidateUrl = $"https://i.ytimg.com/vi/{videoId}/{quality}.jpg";
            if (await ExistsAsync(httpClient, candidateUrl, cancellationToken))
            {
                return (candidateUrl, quality);
            }
        }

        return (null, null);
    }

    /// <summary>
    /// Extracts a YouTube video ID directly from the page URL's own structure
    /// (watch?v=/&lt;youtu.be&gt;/shorts//embed//live/) - never from response content, and never
    /// affected by any trailing query string (e.g. live's own "?si=..." share-tracking
    /// parameter) since only Uri.AbsolutePath is ever inspected for the path-based forms. Used
    /// only when the fetched HTML gave HtmlTitleExtractor no image candidate to start from at all
    /// (see ResolveExistingThumbnailForVideoIdAsync). The video ID character set/length mirrors
    /// YtimgThumbnailUrlRegex's own, since both ultimately name the same i.ytimg.com path segment.
    /// </summary>
    public static bool TryExtractVideoIdFromPageUrl(Uri pageUri, out string? videoId)
    {
        videoId = null;
        if (!IsYouTubeHost(pageUri.Host))
        {
            return false;
        }

        if (pageUri.Host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase))
        {
            return TryValidateVideoId(pageUri.AbsolutePath.Trim('/'), out videoId);
        }

        var queryVideoId = GetQueryParameter(pageUri.Query, "v");
        if (queryVideoId is not null && TryValidateVideoId(queryVideoId, out videoId))
        {
            return true;
        }

        var pathMatch = ShortsEmbedOrLivePathRegex().Match(pageUri.AbsolutePath);
        return pathMatch.Success && TryValidateVideoId(pathMatch.Groups["videoId"].Value, out videoId);
    }

    /// <summary>Internal (not private) so HtmlTitleExtractor's own YouTube-only placeholder-title
    /// check can reuse the exact same host list, rather than duplicating it.</summary>
    internal static bool IsYouTubeHost(string host) =>
        host.Equals("www.youtube.com", StringComparison.OrdinalIgnoreCase)
        || host.Equals("youtube.com", StringComparison.OrdinalIgnoreCase)
        || host.Equals("m.youtube.com", StringComparison.OrdinalIgnoreCase)
        || host.Equals("youtu.be", StringComparison.OrdinalIgnoreCase);

    private static bool TryValidateVideoId(string candidate, out string? videoId)
    {
        videoId = VideoIdRegex().IsMatch(candidate) ? candidate : null;
        return videoId is not null;
    }

    /// <summary>Minimal, dependency-free query-string lookup - avoids pulling in System.Web/
    /// Microsoft.AspNetCore.WebUtilities just for a single "v" parameter read.</summary>
    private static string? GetQueryParameter(string query, string name)
    {
        foreach (var pair in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var separatorIndex = pair.IndexOf('=');
            var key = separatorIndex >= 0 ? pair[..separatorIndex] : pair;
            if (Uri.UnescapeDataString(key) == name)
            {
                return separatorIndex >= 0 ? Uri.UnescapeDataString(pair[(separatorIndex + 1)..]) : string.Empty;
            }
        }

        return null;
    }

    private static async Task<bool> ExistsAsync(HttpClient httpClient, string url, CancellationToken cancellationToken)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Head, url);
            using var response = await httpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return false;
            }

            var contentLength = response.Content.Headers.ContentLength;
            return contentLength is null || contentLength >= MinPlausibleThumbnailBytes;
        }
        catch (Exception exception) when (exception is HttpRequestException or OperationCanceledException)
        {
            // Best-effort only - a network hiccup on the verification hop must never surface as an
            // error; it just means this quality is treated the same as "confirmed missing" and the
            // loop moves on (or gives up gracefully at the end).
            return false;
        }
    }

    [GeneratedRegex(
        @"^https?://i\.ytimg\.com/vi/(?<videoId>[\w-]{6,20})/(?<quality>maxresdefault|sddefault|hqdefault|mqdefault|default)\.jpg$",
        RegexOptions.IgnoreCase)]
    private static partial Regex YtimgThumbnailUrlRegex();

    [GeneratedRegex(@"^[\w-]{6,20}$")]
    private static partial Regex VideoIdRegex();

    [GeneratedRegex(@"^/(?:shorts|embed|live)/(?<videoId>[\w-]{6,20})")]
    private static partial Regex ShortsEmbedOrLivePathRegex();
}
