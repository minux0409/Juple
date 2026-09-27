namespace Juple.Application.Collections.Public;

/// <summary>
/// The anonymous Public Web Viewer's per-Item payload - Title, the original Url, and the automatic
/// link-preview image only. No internal ItemId, Memo, Category, uploaded photos/cover images (those
/// are the owner's private ItemImages and never leave the authenticated API), Purchase data, or any
/// other private field ever reaches this DTO.
///
/// PreviewImageUrl is Item.PreviewImageUrl: the external image URL resolved from the linked page's
/// own public metadata (og:image etc.) - a different field and storage from uploaded ItemImages, so
/// exposing it never exposes a user's own photo.
/// </summary>
public sealed record PublicCollectionItemDto(string? Title, string Url, string? PreviewImageUrl);
