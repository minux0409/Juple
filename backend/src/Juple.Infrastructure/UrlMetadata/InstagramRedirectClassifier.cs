using System.Text.RegularExpressions;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>Where an Instagram redirect points, by path shape only - see InstagramRedirectClassifier.</summary>
public enum InstagramRedirectPathCategory
{
    /// <summary>The same post/reel (same content type + shortcode) or the exact same path - e.g. a trailing-slash/handle-prefix canonicalization.</summary>
    SameContentPath,
    AccountsLogin,
    Challenge,
    Consent,
    Root,
    OtherInstagramPath,
    ExternalHost,
}

/// <summary>Which host a redirect points to - Instagram's own hosts by name, anything else as External.</summary>
public enum InstagramRedirectHostCategory
{
    InstagramWww,
    InstagramApex,
    InstagramMobile,
    InstagramOtherSubdomain,
    External,
}

/// <summary>
/// Diagnostics-only classification of an Instagram redirect hop (see UrlMetadataResolver's redirect
/// logging) - answers "did Instagram send us to its login wall, a challenge, consent, or just
/// canonicalize the same post?" without ever exposing the URL itself. Every output is a fixed enum
/// value: never the path, shortcode, handle, query string (igsh etc.) or any other request-specific
/// text, so the log stays within the existing hostname-only privacy policy. Pure functions over the
/// already-resolved hop URIs - no effect on redirect handling.
/// </summary>
public static partial class InstagramRedirectClassifier
{
    public static InstagramRedirectHostCategory ClassifyHost(Uri destination)
    {
        var host = destination.Host.ToLowerInvariant();
        return host switch
        {
            "www.instagram.com" => InstagramRedirectHostCategory.InstagramWww,
            "instagram.com" => InstagramRedirectHostCategory.InstagramApex,
            "m.instagram.com" => InstagramRedirectHostCategory.InstagramMobile,
            _ when host.EndsWith(".instagram.com", StringComparison.Ordinal) => InstagramRedirectHostCategory.InstagramOtherSubdomain,
            _ => InstagramRedirectHostCategory.External,
        };
    }

    public static InstagramRedirectPathCategory ClassifyPath(Uri source, Uri destination)
    {
        if (ClassifyHost(destination) == InstagramRedirectHostCategory.External)
        {
            return InstagramRedirectPathCategory.ExternalHost;
        }

        var destinationPath = destination.AbsolutePath;
        if (IsSameContent(source.AbsolutePath, destinationPath))
        {
            return InstagramRedirectPathCategory.SameContentPath;
        }

        var lowerPath = destinationPath.ToLowerInvariant();
        if (lowerPath is "" or "/")
        {
            return InstagramRedirectPathCategory.Root;
        }

        if (StartsWithSegment(lowerPath, "/accounts/login"))
        {
            return InstagramRedirectPathCategory.AccountsLogin;
        }

        if (StartsWithSegment(lowerPath, "/challenge"))
        {
            return InstagramRedirectPathCategory.Challenge;
        }

        if (StartsWithSegment(lowerPath, "/consent") || StartsWithSegment(lowerPath, "/privacy/consent"))
        {
            return InstagramRedirectPathCategory.Consent;
        }

        return InstagramRedirectPathCategory.OtherInstagramPath;
    }

    private static bool IsSameContent(string sourcePath, string destinationPath)
    {
        if (string.Equals(sourcePath.TrimEnd('/'), destinationPath.TrimEnd('/'), StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var sourceKey = ContentKey(sourcePath);
        return sourceKey is not null && sourceKey == ContentKey(destinationPath);
    }

    /// <summary>"{type}:{shortcode}" for a post/reel path (optionally "/{handle}"-prefixed), else null - compared only, never logged.</summary>
    private static string? ContentKey(string path)
    {
        var match = ContentPathRegex().Match(path);
        if (!match.Success)
        {
            return null;
        }

        var type = match.Groups["type"].Value.ToLowerInvariant() is "reels" ? "reel" : match.Groups["type"].Value.ToLowerInvariant();
        return $"{type}:{match.Groups["code"].Value}";
    }

    /// <summary>
    /// The post/reel shortcode of an Instagram URL ("/p/{code}", "/reel(s)/{code}", "/tv/{code}",
    /// optionally "/{handle}"-prefixed; query/trailing slash ignored), or null for any other
    /// Instagram path or a non-Instagram host. Shortcodes identify the media itself regardless of
    /// which of those path types Instagram uses for it, so two URLs name the same content iff their
    /// shortcodes match (ordinal - shortcodes are case-sensitive).
    /// </summary>
    public static string? TryGetContentShortcode(Uri uri)
    {
        if (ClassifyHost(uri) == InstagramRedirectHostCategory.External)
        {
            return null;
        }

        var match = ContentPathRegex().Match(uri.AbsolutePath);
        return match.Success ? match.Groups["code"].Value : null;
    }

    private static bool StartsWithSegment(string lowerPath, string prefix) =>
        lowerPath == prefix || lowerPath.StartsWith(prefix + "/", StringComparison.Ordinal);

    [GeneratedRegex(@"^/(?:[A-Za-z0-9._]{1,30}/)?(?<type>p|reels?|tv)/(?<code>[A-Za-z0-9_-]+)/?$", RegexOptions.IgnoreCase)]
    private static partial Regex ContentPathRegex();
}
