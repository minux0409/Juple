using Juple.Application.Images;

namespace Juple.Application.Collections;

/// <summary>One Item inside a Collection's Item list.</summary>
public sealed record CollectionItemEntryDto(
    long ItemId,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset AddedAtUtc,
    RepresentativeImageDto? RepresentativeImage);
