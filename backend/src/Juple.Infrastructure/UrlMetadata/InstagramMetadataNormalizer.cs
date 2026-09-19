using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Instagram's real, currently-live og:description for a post/reel follows a fixed English
/// template regardless of the account's own language: "{N} likes, {M} comments - {username} on
/// {month} {day}, {year}: "{caption}"" (confirmed by direct production fetch during this feature's
/// device verification - e.g. "2,028 likes, 443 comments - oi.pages on August 27, 2026: ...").
/// The username appears bare (no "@", no parentheses) immediately after the "- " and before
/// " on {date}:". The og:title itself ("{display name} on Instagram: \"caption\"") never carries
/// the real username, which is exactly the "낄낄엔터 on Instagram: ..." bug this exists to fix.
///
/// A second, independent signal - og:url - is tried first (see ApplyRealUsername): Instagram's own
/// canonical post/reel URL embeds the real handle directly in its path
/// ("/{handle}/p/{shortcode}/" or "/{handle}/reel/{shortcode}/"), regardless of caption content or
/// whether like/comment counts are even visible for that account. Confirmed by direct production
/// fetch (device verification, 2026-09-17) that some accounts' og:description omits the
/// likes/comments template entirely (e.g. like/comment counts hidden) - "정치크러쉬 on Instagram"
/// (real handle "politics_crush") was exactly this case: no likes/comments prefix to extract from,
/// but og:url still carried "/politics_crush/p/{shortcode}/" correctly. og:url is checked first
/// because it is Instagram's own explicit, structured identifier - never inferred from caption
/// text - and was confirmed to agree with the likes/comments-prefix result for every previously-
/// working account tested (oi.pages, _tripgoing, and others), so preferring it changes no existing
/// correct result.
///
/// IMPORTANT: an earlier version of this normalizer also scanned the *entire* description for a
/// "(@handle)" marker when no explicit boundary was found, on the assumption description would
/// echo the same "... on Instagram:" wrapper as the title. Real device testing proved that
/// assumption wrong (description uses "on {date}:", never "on Instagram:") and the unscoped scan
/// let a name mentioned inside the caption body itself (e.g. a news account crediting a federation
/// "(@thekfa)" as its source) be mistaken for the post's own author - a real misattribution bug.
/// The fix is to require the match to sit inside Instagram's own fixed template text (numbers,
/// "likes"/"comments", "on") immediately after the like/comment counts - never inside the quoted
/// caption - so arbitrary caption content can never be mistaken for the author again. The same
/// discipline applies to og:url below: only the exact "/{handle}/p|reel/{shortcode}/" path shape is
/// ever trusted, never any other part of the URL or page content.
/// </summary>
public static partial class InstagramMetadataNormalizer
{
    private static readonly string[] InstagramHosts = ["instagram.com", "www.instagram.com"];

    public static bool IsInstagramHost(string host) =>
        Array.IndexOf(InstagramHosts, host.ToLowerInvariant()) >= 0;

    /// <summary>
    /// Only rewrites titles of the exact "{name} on Instagram:..." shape (the post/reel share
    /// format) - a profile-page title already shows the handle itself and is left alone. Tries
    /// og:url's own canonical path first, then falls back to the likes/comments-prefix template in
    /// the description - see this class's own remarks for why og:url is preferred and why neither
    /// source is a guess. Never invents a handle from anything else: no display-name-to-username
    /// heuristic, no added "@", no caption scanning - if neither explicit source has one, the title
    /// is returned unchanged.
    /// </summary>
    public static string ApplyRealUsername(string title, string? description, string? canonicalUrl)
    {
        var onInstagramIndex = title.IndexOf(" on Instagram:", StringComparison.Ordinal);
        if (onInstagramIndex < 0)
        {
            return title;
        }

        var handle = TryExtractHandleFromCanonicalUrl(canonicalUrl)
            ?? ExtractHandleFromLikesCommentsPrefix(description);
        if (handle is null)
        {
            return title;
        }

        return handle + title[onInstagramIndex..];
    }

    /// <summary>
    /// Instagram's own canonical post/reel URL (the page's og:url) always embeds the real handle as
    /// the path's first segment - "/{handle}/p/{shortcode}/" or "/{handle}/reel/{shortcode}/" -
    /// independent of caption content, display name, or like/comment count visibility. A
    /// two-segment canonical URL ("/p/{shortcode}/" - the shape al:android:url and the plain
    /// &lt;link rel="canonical"&gt; tag use) has no handle in it at all and correctly yields null
    /// here rather than guessing one.
    /// </summary>
    private static string? TryExtractHandleFromCanonicalUrl(string? canonicalUrl)
    {
        if (string.IsNullOrWhiteSpace(canonicalUrl)
            || !Uri.TryCreate(canonicalUrl, UriKind.Absolute, out var uri)
            || !IsInstagramHost(uri.Host))
        {
            return null;
        }

        var match = CanonicalUrlHandleRegex().Match(uri.AbsolutePath);
        return match.Success ? match.Groups["handle"].Value : null;
    }

    /// <summary>
    /// Matches only Instagram's own generated prefix - digits, "likes"/"comments", a dash, the
    /// username, then " on " - which always precedes the quoted caption in the real description.
    /// Anchored at the start of the string so it can never match text appearing later inside the
    /// caption body itself.
    /// </summary>
    private static string? ExtractHandleFromLikesCommentsPrefix(string? description)
    {
        if (string.IsNullOrEmpty(description))
        {
            return null;
        }

        var match = LikesCommentsPrefixRegex().Match(description);
        return match.Success ? match.Groups["handle"].Value : null;
    }

    // "{N} likes, {M} comments - {handle} on " - Instagram's own fixed English template text
    // (never affected by the account's or caption's language). Handle charset matches Instagram's
    // real username rules: letters/digits/periods/underscores, 1-30 characters.
    [GeneratedRegex(
        @"^\s*[\d,]+\s+likes?,\s*[\d,]+\s+comments?\s*-\s*(?<handle>[A-Za-z0-9._]{1,30})\s+on\s+",
        RegexOptions.IgnoreCase)]
    private static partial Regex LikesCommentsPrefixRegex();

    // "/{handle}/p/{shortcode}/" or "/{handle}/reel/{shortcode}/" - anchored at both ends so a
    // longer/different path shape (profile sub-pages, "/explore/", "/stories/", etc.) never
    // matches. Handle charset matches Instagram's real username rules, same as the likes/comments
    // regex above.
    [GeneratedRegex(
        @"^/(?<handle>[A-Za-z0-9._]{1,30})/(?:p|reel)/[A-Za-z0-9_-]+/?$", RegexOptions.IgnoreCase)]
    private static partial Regex CanonicalUrlHandleRegex();
}
