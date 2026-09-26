namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Which image URLs may be stored as an Instagram post's automatic preview image when the value came
/// from a client (the device-fetched candidate - see InstagramMetadataCandidateNormalizer): absolute
/// HTTPS on the default port, no userinfo, and served from Instagram's or Meta's media CDNs only -
/// "*.cdninstagram.com" (e.g. scontent-*.cdninstagram.com) and "*.fbcdn.net" (Instagram media is
/// also served from Meta's shared CDN, e.g. instagram.f{region}-1.fna.fbcdn.net), never an arbitrary
/// host. static.cdninstagram.com is excluded: it serves Instagram's own generic UI assets (the
/// login-shell icon), never a post's photo - the same rule UrlMetadataResolver applies.
/// </summary>
public static class InstagramImageUrlPolicy
{
    public static bool IsAllowedPostImage(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || uri.Scheme != Uri.UriSchemeHttps
            || !uri.IsDefaultPort
            || !string.IsNullOrEmpty(uri.UserInfo))
        {
            return false;
        }

        var host = uri.Host.ToLowerInvariant();
        if (host == "static.cdninstagram.com")
        {
            return false;
        }

        return host.EndsWith(".cdninstagram.com", StringComparison.Ordinal)
            || host.EndsWith(".fbcdn.net", StringComparison.Ordinal);
    }
}
