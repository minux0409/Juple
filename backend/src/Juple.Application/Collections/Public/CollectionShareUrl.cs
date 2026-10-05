using System.Text.RegularExpressions;

namespace Juple.Application.Collections.Public;

/// <summary>
/// Recognizes a canonical Juple Collection share URL - https://{the configured public web host}/c/{publicId},
/// query string and fragment allowed. A Collection is never an ordinary saved link: such a URL must not become
/// an Item (the invariant lives on the server too, so an older client or a direct API call cannot bypass it).
///
/// The same rule as the app (see apps/mobile/src/share/collectionShareUrl.ts): decided by parsing against the
/// configured host only - a lookalike host, another path of the same host (/about, /c, /c/x/y), a scheme other
/// than https, credentials, a non-default port or a malformed id is NOT a Collection share link and saves as the
/// ordinary URL it is. With no host configured nothing is recognized (there is nothing to guess a host from).
/// </summary>
public static partial class CollectionShareUrl
{
    /// <summary>8-64 base64url characters - exactly the app's pattern (the server mints 32).</summary>
    [GeneratedRegex("^[A-Za-z0-9_-]{8,64}$", RegexOptions.CultureInvariant)]
    private static partial Regex PublicIdPattern();

    /// <summary>The public id of a canonical share URL on publicWebHost (a bare host, or a base URL whose host is used), else null.</summary>
    public static string? TryGetPublicId(string? value, string? publicWebHostOrBaseUrl)
    {
        var host = HostOf(publicWebHostOrBaseUrl);
        var trimmed = value?.Trim();
        if (host is null || string.IsNullOrEmpty(trimmed) || trimmed.Any(char.IsWhiteSpace))
        {
            return null;
        }

        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !string.IsNullOrEmpty(uri.UserInfo)
            || !uri.IsDefaultPort
            || !string.Equals(uri.IdnHost, host, StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        // /c/{id} or /c/{id}/ - nothing else.
        var segments = uri.AbsolutePath.Split('/', StringSplitOptions.None);
        var isCanonicalPath = (segments.Length == 3 && segments[0].Length == 0 && segments[1] == "c")
            || (segments.Length == 4 && segments[0].Length == 0 && segments[1] == "c" && segments[3].Length == 0);
        if (!isCanonicalPath)
        {
            return null;
        }

        string publicId;
        try
        {
            publicId = Uri.UnescapeDataString(segments[2]);
        }
        catch (UriFormatException)
        {
            return null;
        }

        return PublicIdPattern().IsMatch(publicId) ? publicId : null;
    }

    private static string? HostOf(string? hostOrBaseUrl)
    {
        var configured = hostOrBaseUrl?.Trim();
        if (string.IsNullOrEmpty(configured))
        {
            return null;
        }

        if (Uri.TryCreate(configured, UriKind.Absolute, out var baseUri) && !string.IsNullOrEmpty(baseUri.Host))
        {
            return baseUri.IdnHost;
        }

        // A bare host ("dev.juple.co.kr").
        return Uri.TryCreate("https://" + configured, UriKind.Absolute, out var bare) && !string.IsNullOrEmpty(bare.Host) ? bare.IdnHost : null;
    }
}

/// <summary>Whether a URL is a canonical Juple Collection share URL, by the deployment's configured public web host.</summary>
public interface ICollectionShareUrlDetector
{
    /// <summary>The Collection's public id when url is a canonical share URL; otherwise null.</summary>
    string? FindPublicId(string? url);
}

/// <summary>
/// 400 with the stable code <see cref="Code"/>: the URL is a Juple Collection share link, which is never saved as an
/// ordinary link. PublicId lets a client open the Collection instead - the id of a link the caller already holds.
/// </summary>
public sealed class CollectionShareUrlNotSavableException(string publicId) : Exception("A Juple Collection share link cannot be saved as a link.")
{
    public const string Code = "collectionShareUrlNotSavableAsLink";

    public string PublicId { get; } = publicId;
}
