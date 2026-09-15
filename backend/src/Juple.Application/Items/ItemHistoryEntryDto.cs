using Juple.Application.Images;

namespace Juple.Application.Items;

/// <summary>
/// One History row - the Item as it was originally saved. PreviewImageUrl/CoverImage are exposed
/// here purely as data - see docs on this round's Home-only thumbnail scope: History's own
/// rendering intentionally does not change, only Home's SavedLinkRow usage does.
/// </summary>
public sealed record ItemHistoryEntryDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    RepresentativeImageDto? RepresentativeImage,
    string? PreviewImageUrl,
    RepresentativeImageDto? CoverImage);
