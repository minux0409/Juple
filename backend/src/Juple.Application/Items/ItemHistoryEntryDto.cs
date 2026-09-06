using Juple.Application.Images;

namespace Juple.Application.Items;

/// <summary>One History row - the Item as it was originally saved.</summary>
public sealed record ItemHistoryEntryDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    RepresentativeImageDto? RepresentativeImage);
