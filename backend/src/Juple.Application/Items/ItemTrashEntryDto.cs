using Juple.Application.Images;

namespace Juple.Application.Items;

/// <summary>
/// One Trash row - the minimum a trash list screen needs. Deliberately excludes Memo (unlike
/// ItemHistoryEntryDto) since a trash list has no use for it and this must not expose more than
/// the screen needs.
/// </summary>
public sealed record ItemTrashEntryDto(
    long Id,
    string Url,
    string? Title,
    DateTimeOffset DeletedAtUtc,
    RepresentativeImageDto? RepresentativeImage,
    string? PreviewImageUrl,
    RepresentativeImageDto? CoverImage);
