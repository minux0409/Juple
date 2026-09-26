using System.Text;
using Juple.Application.Items.InstagramMetadataCandidate;

namespace Juple.Infrastructure.UrlMetadata;

/// <summary>
/// Runs a device-fetched OpenGraph candidate through the same rules HtmlTitleExtractor applies to a
/// page the Backend fetched itself (HtmlTitleExtractor.NormalizeTitle's whitespace/length/placeholder
/// and login-wall filtering, InstagramMetadataNormalizer's real-handle normalization,
/// HtmlTitleExtractor.ValidateImageUrl) plus the client-input-specific identity and image-host checks
/// (InstagramRedirectClassifier.TryGetContentShortcode, InstagramImageUrlPolicy). The device only ever
/// sends raw values; nothing here trusts it to have normalized anything.
/// </summary>
public sealed class InstagramMetadataCandidateNormalizer : IInstagramMetadataCandidateNormalizer
{
    public NormalizedInstagramMetadata? Normalize(string itemUrl, InstagramMetadataCandidateCommand candidate)
    {
        if (!Uri.TryCreate(itemUrl, UriKind.Absolute, out var itemUri)
            || InstagramRedirectClassifier.TryGetContentShortcode(itemUri) is not { } itemShortcode)
        {
            return null;
        }

        var ogUrl = StripControlCharacters(candidate.OgUrl)?.Trim();
        if (!string.IsNullOrEmpty(ogUrl))
        {
            if (!Uri.TryCreate(ogUrl, UriKind.Absolute, out var ogUri)
                || ogUri.Scheme != Uri.UriSchemeHttps
                || !string.Equals(
                    InstagramRedirectClassifier.TryGetContentShortcode(ogUri), itemShortcode, StringComparison.Ordinal))
            {
                return null;
            }
        }

        var title = HtmlTitleExtractor.NormalizeTitle(StripControlCharacters(candidate.OgTitle));
        if (title is not null)
        {
            // og:url (now verified to be this same post) first, then the likes/comments description
            // template - exactly HtmlTitleExtractor.ApplyInstagramUsername's inputs for a fetched page.
            title = InstagramMetadataNormalizer.ApplyRealUsername(
                title, StripControlCharacters(candidate.OgDescription), string.IsNullOrEmpty(ogUrl) ? null : ogUrl);
        }

        var image = HtmlTitleExtractor.ValidateImageUrl(StripControlCharacters(candidate.OgImage));
        if (image is not null && !InstagramImageUrlPolicy.IsAllowedPostImage(image))
        {
            image = null;
        }

        return new NormalizedInstagramMetadata(title, image);
    }

    /// <summary>A client-supplied string never carries control characters into a title/URL (whitespace controls become spaces, the rest are dropped).</summary>
    private static string? StripControlCharacters(string? value)
    {
        if (value is null)
        {
            return null;
        }

        var builder = new StringBuilder(value.Length);
        foreach (var character in value)
        {
            if (!char.IsControl(character))
            {
                builder.Append(character);
            }
            else if (char.IsWhiteSpace(character))
            {
                builder.Append(' ');
            }
        }

        return builder.ToString();
    }
}
