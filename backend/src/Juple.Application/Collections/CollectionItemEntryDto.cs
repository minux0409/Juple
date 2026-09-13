using Juple.Application.Images;

namespace Juple.Application.Collections;

/// <summary>One Item inside a Collection's Item list. SortOrder is the owner's manual display order (see CollectionItem.SortOrder) - clients should not re-derive numbering from page position alone across pages.</summary>
public sealed record CollectionItemEntryDto(
    long ItemId,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset AddedAtUtc,
    int SortOrder,
    RepresentativeImageDto? RepresentativeImage);
