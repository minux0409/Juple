using System.Text.Json;
using System.Text.RegularExpressions;
using AngleSharp;
using AngleSharp.Dom;
using Juple.Application.UrlMetadata;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Pure HTML -&gt; title/preview-image extraction, deliberately separate from the HTTP fetch
/// (UrlMetadataResolver) so priority ordering/normalization/generic-title filtering can be
/// unit-tested against raw HTML strings with no network involved. Uses AngleSharp (MIT-licensed,
/// actively maintained DOM parser) rather than regex-scraping the HTML - queries og:title/
/// twitter:title/&lt;title&gt; and og:image/twitter:image specifically via the parsed DOM, so
/// script/style text can never be mistaken for a title, and malformed HTML is tolerated the same
/// way a browser would.
/// </summary>
public static partial class HtmlTitleExtractor
{
    private const int MaxTitleLength = 300;
    private const int MaxImageUrlLength = 4096;

    /// <summary>
    /// Known non-content titles a public HTML fetch can still legitimately return (e.g. an
    /// Instagram login wall) - filtered out so they never get stored as an Item's title. This is
    /// a title-quality filter on the ordinary public response, not Instagram-specific scraping or
    /// a login-wall bypass.
    /// </summary>
    private static readonly string[] GenericExactTitles = ["instagram", "log in • instagram", "login • instagram"];

    public static async Task<(string? Title, UrlMetadataSource? Source, string? PreviewImageUrl, UrlMetadataImageSource? PreviewImageSource)> ExtractAsync(
        string html, CancellationToken cancellationToken, string host = "")
    {
        using var context = BrowsingContext.New(Configuration.Default);

        IDocument document;
        try
        {
            document = await context.OpenAsync(request => request.Content(html), cancellationToken);
        }
        catch
        {
            // Malformed/unparseable HTML - AngleSharp is already lenient (html5lib-style), so this
            // is a last-resort guard, not the expected path for ordinary imperfect markup.
            return (null, null, null, null);
        }

        var (previewImageUrl, previewImageSource) = ExtractPreviewImageUrl(document);

        var openGraphTitle = NormalizeTitle(
            document.QuerySelector("meta[property='og:title']")?.GetAttribute("content"));
        if (openGraphTitle is not null && !IsKnownPlaceholderTitle(host, openGraphTitle))
        {
            return (
                ApplyInstagramUsername(host, openGraphTitle, document), UrlMetadataSource.OpenGraph,
                previewImageUrl, previewImageSource);
        }

        var twitterTitle = NormalizeTitle(
            document.QuerySelector("meta[name='twitter:title']")?.GetAttribute("content"));
        if (twitterTitle is not null && !IsKnownPlaceholderTitle(host, twitterTitle))
        {
            return (
                ApplyInstagramUsername(host, twitterTitle, document), UrlMetadataSource.Twitter,
                previewImageUrl, previewImageSource);
        }

        var htmlTitle = NormalizeTitle(document.Title);
        if (htmlTitle is not null && !IsKnownPlaceholderTitle(host, htmlTitle))
        {
            return (htmlTitle, UrlMetadataSource.HtmlTitle, previewImageUrl, previewImageSource);
        }

        return (null, null, previewImageUrl, previewImageSource);
    }

    /// <summary>
    /// Instagram-only (see InstagramMetadataNormalizer) - looks at the same document's og:url (the
    /// canonical post/reel URL, checked first) and og:description/twitter:description (the
    /// likes/comments-prefix fallback) for the real handle alongside the already-selected title.
    /// </summary>
    private static string ApplyInstagramUsername(string host, string title, IDocument document)
    {
        if (!InstagramMetadataNormalizer.IsInstagramHost(host))
        {
            return title;
        }

        var description =
            document.QuerySelector("meta[property='og:description']")?.GetAttribute("content")
            ?? document.QuerySelector("meta[name='twitter:description']")?.GetAttribute("content");

        var canonicalUrl = document.QuerySelector("meta[property='og:url']")?.GetAttribute("content");

        return InstagramMetadataNormalizer.ApplyRealUsername(title, description, canonicalUrl);
    }

    /// <summary>
    /// Priority: og:image:secure_url -&gt; og:image -&gt; twitter:image -&gt; a JSON-LD "image" (schema.org
    /// structured data, e.g. &lt;script type="application/ld+json"&gt;) -&gt; null. No other
    /// platform-specific image field was found beyond these for either YouTube (og:image already
    /// gives its video thumbnail) or Instagram (see docs on this round's "do not guess" scope) -
    /// see UrlMetadataResult's remarks. Never the page's first &lt;img&gt; and never anything drawn
    /// from a caption/description's own text - only these explicit, page-author-declared metadata
    /// fields are ever trusted.
    /// </summary>
    private static (string? Url, UrlMetadataImageSource? Source) ExtractPreviewImageUrl(IDocument document)
    {
        var secureUrl = ValidateImageUrl(
            document.QuerySelector("meta[property='og:image:secure_url']")?.GetAttribute("content"));
        if (secureUrl is not null)
        {
            return (secureUrl, UrlMetadataImageSource.OpenGraphSecureUrl);
        }

        var openGraphImage = ValidateImageUrl(
            document.QuerySelector("meta[property='og:image']")?.GetAttribute("content"));
        if (openGraphImage is not null)
        {
            return (openGraphImage, UrlMetadataImageSource.OpenGraphImage);
        }

        var twitterImage = ValidateImageUrl(
            document.QuerySelector("meta[name='twitter:image']")?.GetAttribute("content"));
        if (twitterImage is not null)
        {
            return (twitterImage, UrlMetadataImageSource.TwitterImage);
        }

        var jsonLdImage = ExtractJsonLdImageUrl(document);
        return jsonLdImage is not null ? (jsonLdImage, UrlMetadataImageSource.JsonLd) : (null, null);
    }

    /// <summary>
    /// Looks for a schema.org "image" value across every &lt;script type="application/ld+json"&gt;
    /// block, in document order - the first valid http(s) image URL wins. Handles the handful of
    /// shapes schema.org actually allows for "image": a bare URL string, an array of URL strings,
    /// an ImageObject ({"url": "..."}), or an array of ImageObjects - and, since a single page can
    /// legally declare its structured data as a JSON-LD array of separate objects (not just an
    /// array-valued "image" property), a top-level JSON array is also unwrapped one level before
    /// each entry is checked the same way. Any block that isn't valid JSON, or has no usable
    /// "image", is silently skipped - this is best-effort enrichment, never a parse failure.
    /// </summary>
    private static string? ExtractJsonLdImageUrl(IDocument document)
    {
        foreach (var script in document.QuerySelectorAll("script[type='application/ld+json']"))
        {
            var raw = script.TextContent;
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }

            JsonDocument jsonDocument;
            try
            {
                jsonDocument = JsonDocument.Parse(raw);
            }
            catch (JsonException)
            {
                continue;
            }

            using (jsonDocument)
            {
                var root = jsonDocument.RootElement;
                IEnumerable<JsonElement> candidates = root.ValueKind == JsonValueKind.Array
                    ? root.EnumerateArray()
                    : [root];

                foreach (var candidate in candidates)
                {
                    var imageUrl = ExtractImageUrlFromJsonLdNode(candidate);
                    if (imageUrl is not null)
                    {
                        return imageUrl;
                    }
                }
            }
        }

        return null;
    }

    private static string? ExtractImageUrlFromJsonLdNode(JsonElement node)
    {
        if (node.ValueKind != JsonValueKind.Object || !node.TryGetProperty("image", out var image))
        {
            return null;
        }

        return image.ValueKind switch
        {
            JsonValueKind.String => ValidateImageUrl(image.GetString()),
            JsonValueKind.Object => ValidateImageUrl(
                image.TryGetProperty("url", out var url) && url.ValueKind == JsonValueKind.String
                    ? url.GetString()
                    : null),
            JsonValueKind.Array => image.EnumerateArray()
                .Select(element => element.ValueKind switch
                {
                    JsonValueKind.String => ValidateImageUrl(element.GetString()),
                    JsonValueKind.Object => ValidateImageUrl(
                        element.TryGetProperty("url", out var elementUrl) && elementUrl.ValueKind == JsonValueKind.String
                            ? elementUrl.GetString()
                            : null),
                    _ => null,
                })
                .FirstOrDefault(url => url is not null),
            _ => null,
        };
    }

    /// <summary>
    /// Only ever accepts an absolute http/https URL - never data:/file:/blob:/javascript: or a
    /// relative path, and never truncated (a truncated URL would just be a different, broken/
    /// dangerous link, not a shorter valid one) - an overlong or malformed value is treated the
    /// same as "no image found".
    /// </summary>
    internal static string? ValidateImageUrl(string? rawUrl)
    {
        if (string.IsNullOrWhiteSpace(rawUrl))
        {
            return null;
        }

        var trimmed = rawUrl.Trim();
        if (trimmed.Length > MaxImageUrlLength
            || !Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps))
        {
            return null;
        }

        return trimmed;
    }

    /// <summary>
    /// AngleSharp already HTML-entity-decodes attribute/text content while parsing, so this only
    /// needs to trim, collapse internal whitespace, cap length, and drop known generic/placeholder
    /// titles - never a raw HtmlDecode step.
    /// </summary>
    internal static string? NormalizeTitle(string? raw)
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

        if (collapsed.Length > MaxTitleLength)
        {
            collapsed = collapsed[..MaxTitleLength].TrimEnd();
        }

        return IsGenericPlaceholderTitle(collapsed) ? null : collapsed;
    }

    private static bool IsGenericPlaceholderTitle(string normalizedTitle)
    {
        var lower = normalizedTitle.ToLowerInvariant();
        if (Array.IndexOf(GenericExactTitles, lower) >= 0)
        {
            return true;
        }

        // Broader login-wall heuristic: "log in"/"login" combined with a bare platform name and
        // nothing else meaningful (e.g. "Log in to Instagram").
        return (lower.Contains("log in") || lower.Contains("login")) && lower.Contains("instagram");
    }

    /// <summary>
    /// A second, source-and-host-gated filter run on top of the already-normalized candidate
    /// (unlike IsGenericPlaceholderTitle above, which runs unconditionally inside NormalizeTitle
    /// itself) - this one only ever applies to YouTube, and only to the exact strings YouTube's
    /// own og:title/twitter:title/&lt;title&gt; are confirmed to return when its server-side title
    /// lookup itself comes back empty (observed on real device saves as "- YouTube"). Deliberately
    /// never a generic "title equals site name" heuristic across arbitrary sites - a page whose
    /// real, author-chosen title happens to equal its own site name must still be trusted
    /// everywhere except this one confirmed provider case, per this round's "일반 사이트 전체에
    /// 공격적인 title 필터를 적용하지 않는다" requirement. Returning true here means "treat this
    /// candidate as if it were empty" - ExtractAsync falls through to the next source exactly like
    /// it already does for a blank/whitespace-only value.
    /// </summary>
    private static bool IsKnownPlaceholderTitle(string host, string normalizedTitle)
    {
        if (!YouTubeThumbnailResolver.IsYouTubeHost(host))
        {
            return false;
        }

        var lower = normalizedTitle.ToLowerInvariant();
        return lower is "youtube" or "- youtube";
    }

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
