using System.Text.RegularExpressions;
using AngleSharp;
using AngleSharp.Dom;
using Juple.Application.UrlMetadata;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Pure HTML -&gt; title extraction, deliberately separate from the HTTP fetch (UrlMetadataResolver)
/// so priority ordering/normalization/generic-title filtering can be unit-tested against raw HTML
/// strings with no network involved. Uses AngleSharp (MIT-licensed, actively maintained DOM
/// parser) rather than regex-scraping the HTML - queries og:title/twitter:title/&lt;title&gt;
/// specifically via the parsed DOM, so script/style text can never be mistaken for a title, and
/// malformed HTML is tolerated the same way a browser would.
/// </summary>
public static partial class HtmlTitleExtractor
{
    private const int MaxTitleLength = 300;

    /// <summary>
    /// Known non-content titles a public HTML fetch can still legitimately return (e.g. an
    /// Instagram login wall) - filtered out so they never get stored as an Item's title. This is
    /// a title-quality filter on the ordinary public response, not Instagram-specific scraping or
    /// a login-wall bypass.
    /// </summary>
    private static readonly string[] GenericExactTitles = ["instagram", "log in • instagram", "login • instagram"];

    public static async Task<(string? Title, UrlMetadataSource? Source)> ExtractAsync(
        string html, CancellationToken cancellationToken)
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
            return (null, null);
        }

        var openGraphTitle = NormalizeTitle(
            document.QuerySelector("meta[property='og:title']")?.GetAttribute("content"));
        if (openGraphTitle is not null)
        {
            return (openGraphTitle, UrlMetadataSource.OpenGraph);
        }

        var twitterTitle = NormalizeTitle(
            document.QuerySelector("meta[name='twitter:title']")?.GetAttribute("content"));
        if (twitterTitle is not null)
        {
            return (twitterTitle, UrlMetadataSource.Twitter);
        }

        var htmlTitle = NormalizeTitle(document.Title);
        if (htmlTitle is not null)
        {
            return (htmlTitle, UrlMetadataSource.HtmlTitle);
        }

        return (null, null);
    }

    /// <summary>
    /// AngleSharp already HTML-entity-decodes attribute/text content while parsing, so this only
    /// needs to trim, collapse internal whitespace, cap length, and drop known generic/placeholder
    /// titles - never a raw HtmlDecode step.
    /// </summary>
    private static string? NormalizeTitle(string? raw)
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

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();
}
