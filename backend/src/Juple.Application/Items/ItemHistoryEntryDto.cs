using Juple.Application.Images;

namespace Juple.Application.Items;

/// <summary>
/// One History row - the Item as it was originally saved, regardless of its current
/// Inbox/Wishlist/Archived state. Deliberately carries no State: History orders and groups by
/// SavedAtUtc only, never by state.
/// </summary>
public sealed record ItemHistoryEntryDto(
    long Id,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset SavedAtUtc,
    ItemCategoryDto? Category,
    RepresentativeImageDto? RepresentativeImage);
