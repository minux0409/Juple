namespace Juple.Application.Items.InstagramMetadataCandidate;

/// <summary>
/// Applies the exact same title/image rules the Backend's own URL metadata extraction uses
/// (placeholder/login-wall title filtering, real-handle normalization, generic Instagram icon
/// rejection) to a device-fetched candidate - implemented in Infrastructure next to those rules so
/// there is only ever one copy of them.
/// </summary>
public interface IInstagramMetadataCandidateNormalizer
{
    /// <summary>
    /// Null when the candidate as a whole must be rejected: the Item's saved URL is not an Instagram
    /// post/reel, or og:url is present but is not the same Instagram content (another post). Otherwise
    /// the usable values - either or both may be null.
    /// </summary>
    NormalizedInstagramMetadata? Normalize(string itemUrl, InstagramMetadataCandidateCommand candidate);
}
