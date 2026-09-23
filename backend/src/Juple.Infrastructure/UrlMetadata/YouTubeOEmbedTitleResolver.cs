using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Fallback title source for a YouTube page whose own fetched HTML gave HtmlTitleExtractor nothing
/// usable - no og:title/twitter:title/&lt;title&gt; at all, or only YouTube's own known
/// empty-title placeholder (see HtmlTitleExtractor.IsKnownPlaceholderTitle). YouTube's public,
/// unauthenticated oEmbed endpoint (https://www.youtube.com/oembed) is the same publicly
/// documented embed-preview endpoint any site linking to a YouTube video already relies on - no
/// API key, no OAuth, no YouTube Data API v3/billing/quota dependency.
///
/// The request destination is always this one fixed host+path; the original page URL is only ever
/// passed as its "url" query value, never used to choose where the request itself goes. The
/// existing SSRF-hardened HttpClient (see DependencyInjection.AddUrlMetadataResolver) is reused
/// unmodified for the actual connection/DNS validation - this call adds nothing to that guard and
/// removes nothing from it.
///
/// Best-effort only, exactly like every other piece of metadata extraction in this feature: any
/// non-2xx status (including a redirect, since the shared handler already has
/// AllowAutoRedirect=false), timeout, oversized, or malformed-JSON response resolves to null -
/// never an exception a caller has to handle, and never something that fails the overall
/// UrlMetadataResolver.ResolveAsync call. Uses its own short timeout (well under the outer
/// request's total budget) so a slow/hanging oEmbed call can't consume the whole resolve.
/// </summary>
public static partial class YouTubeOEmbedTitleResolver
{
    private const long MaxResponseBytes = 64 * 1024;
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(4);

    public static async Task<string?> ResolveTitleAsync(
        HttpClient httpClient, Uri pageUri, CancellationToken cancellationToken)
    {
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeoutCts.CancelAfter(RequestTimeout);

        try
        {
            var requestUri = new Uri(
                "https://www.youtube.com/oembed?format=json&url=" + Uri.EscapeDataString(pageUri.ToString()));
            using var request = new HttpRequestMessage(HttpMethod.Get, requestUri);
            using var response = await httpClient.SendAsync(
                request, HttpCompletionOption.ResponseHeadersRead, timeoutCts.Token);

            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            var json = await ReadBoundedJsonAsync(response, timeoutCts.Token);

            using var document = JsonDocument.Parse(json);
            if (!document.RootElement.TryGetProperty("title", out var titleElement)
                || titleElement.ValueKind != JsonValueKind.String)
            {
                return null;
            }

            return NormalizeOEmbedTitle(titleElement.GetString());
        }
        catch (Exception exception) when (
            exception is HttpRequestException or OperationCanceledException or JsonException or UriFormatException)
        {
            return null;
        }
    }

    /// <summary>Same bounded-read shape as UrlMetadataResolver.ReadBoundedHtmlAsync, sized for a
    /// JSON body instead of HTML - oEmbed responses are always small (a handful of fields).</summary>
    private static async Task<string> ReadBoundedJsonAsync(
        HttpResponseMessage response, CancellationToken cancellationToken)
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

    /// <summary>Mirrors HtmlTitleExtractor.NormalizeTitle/IsKnownPlaceholderTitle for this one
    /// YouTube-only source - an oEmbed title can itself be the exact same empty-lookup placeholder
    /// ("YouTube"/"- YouTube") HTML sometimes returns, and must be rejected the same way.</summary>
    private static string? NormalizeOEmbedTitle(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        var collapsed = WhitespaceRegex().Replace(raw.Trim(), " ").Trim();
        if (collapsed.Length == 0)
        {
            return null;
        }

        var lower = collapsed.ToLowerInvariant();
        return lower is "youtube" or "- youtube" ? null : collapsed;
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
