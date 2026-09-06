namespace Juple.Application.Collections.Public;

/// <summary>
/// The anonymous Public Web Viewer's per-Item payload - Title and the original Url only. No
/// internal ItemId, Memo, Category, RepresentativeImage/thumbnail (see PublicCollectionStore's own
/// doc for why images are out of scope for this first step), Purchase/RepeatPurchase data, or any
/// other private field ever reaches this DTO.
/// </summary>
public sealed record PublicCollectionItemDto(string? Title, string Url);
