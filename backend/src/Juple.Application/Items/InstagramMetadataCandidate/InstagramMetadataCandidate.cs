namespace Juple.Application.Items.InstagramMetadataCandidate;

/// <summary>
/// Raw OpenGraph values a user's own device extracted from Instagram's public page for an Item it
/// just saved (see the mobile instagramOpenGraphFetch helper) - untrusted client input, never the
/// HTML itself. Every field is optional; the Backend decides what (if anything) is usable.
/// </summary>
public sealed record InstagramMetadataCandidateCommand(
    string? OgTitle,
    string? OgImage,
    string? OgUrl,
    string? OgDescription);

/// <summary>A candidate after Backend-side validation/normalization - only these values may ever be applied.</summary>
public sealed record NormalizedInstagramMetadata(string? Title, string? PreviewImageUrl);

/// <summary>
/// The Item's automatic-metadata state after the candidate was considered - Applied is false when
/// nothing changed (nothing usable, or both fields were already filled by the user/another source).
/// </summary>
public sealed record InstagramMetadataCandidateResult(string? Title, string? PreviewImageUrl, bool Applied);
