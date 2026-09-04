using Juple.Application.Images;
using Juple.Application.Items;

namespace Juple.Application.Collections;

/// <summary>
/// One Item inside a Collection's Item list. Deliberately has no State field - Collection
/// membership is completely independent of the Item's current Inbox/Wishlist/Archived state (an
/// Item stays in a Collection across any state transition), the same design already used for
/// ItemHistoryEntryDto.
/// </summary>
public sealed record CollectionItemEntryDto(
    long ItemId,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset AddedAtUtc,
    ItemCategoryDto? Category,
    RepresentativeImageDto? RepresentativeImage);
