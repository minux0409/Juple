using Juple.Application.Images;

namespace Juple.Application.Items;

public sealed record ItemDetailsDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    RepresentativeImageDto? RepresentativeImage);
