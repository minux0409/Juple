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

        var videoId = match.Groups["videoId"].Value;
        var startIndex = Array.IndexOf(QualityFallbackOrder, match.Groups["quality"].Value.ToLowerInvariant());
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
}
