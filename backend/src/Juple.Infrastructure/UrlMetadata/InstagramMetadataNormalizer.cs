using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Instagram's real, currently-live og:description for a post/reel follows a fixed English
/// template regardless of the account's own language: "{N} likes, {M} comments - {username} on
/// {month} {day}, {year}: "{caption}"" (confirmed by direct production fetch during this feature's
/// device verification - e.g. "2,028 likes, 443 comments - oi.pages on August 27, 2026: ...").
/// The username appears bare (no "@", no parentheses) immediately after the "- " and before
/// " on {date}:". This is the only reliable, explicit author-identifying signal found in this
/// metadata - the og:title itself ("{display name} on Instagram: \"caption\"") never carries the
/// real username, which is exactly the "낄낄엔터 on Instagram: ..." bug this exists to fix.
///
/// IMPORTANT: an earlier version of this normalizer also scanned the *entire* description for a
/// "(@handle)" marker when no explicit boundary was found, on the assumption description would
/// echo the same "... on Instagram:" wrapper as the title. Real device testing proved that
/// assumption wrong (description uses "on {date}:", never "on Instagram:") and the unscoped scan
/// let a name mentioned inside the caption body itself (e.g. a news account crediting a federation
/// "(@thekfa)" as its source) be mistaken for the post's own author - a real misattribution bug.
/// The fix is to require the match to sit inside Instagram's own fixed template text (numbers,
/// "likes"/"comments", "on") immediately after the like/comment counts - never inside the quoted
/// caption - so arbitrary caption content can never be mistaken for the author again.
/// </summary>
public static partial class InstagramMetadataNormalizer
{
    private static readonly string[] InstagramHosts = ["instagram.com", "www.instagram.com"];

    public static bool IsInstagramHost(string host) =>
        Array.IndexOf(InstagramHosts, host.ToLowerInvariant()) >= 0;

    /// <summary>
    /// Only rewrites titles of the exact "{name} on Instagram:..." shape (the post/reel share
    /// format) - a profile-page title already shows the handle itself and is left alone. Never
    /// guesses: no URL-based inference, no display-name-to-username heuristic, no added "@" - if no
    /// handle can be found in Instagram's own fixed template text, the title is returned unchanged.
    /// </summary>
    public static string ApplyRealUsername(string title, string? description)
    {
        var onInstagramIndex = title.IndexOf(" on Instagram:", StringComparison.Ordinal);
        if (onInstagramIndex < 0)
        {
            return title;
        }

        var handle = ExtractHandleFromLikesCommentsPrefix(description);
        if (handle is null)
        {
            return title;
        }

        return handle + title[onInstagramIndex..];
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
}
