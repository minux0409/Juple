using Juple.Application.Images;

namespace Juple.Application.Collections;

/// <summary>
/// One Item inside a Collection's Item list. SortOrder is the owner's manual display order (see
/// CollectionItem.SortOrder) - clients should not re-derive numbering from page position alone
/// across pages. RepresentativeImage/PreviewImageUrl/CoverImage mirror ItemHistoryEntryDto's own
/// three thumbnail sources exactly, so a client picks the same effective thumbnail here as on
/// Home/History for the same Item (see resolveEffectiveThumbnailUrl on the Mobile side) - this
/// record used to omit PreviewImageUrl/CoverImage entirely, which was the root cause of Category
/// showing no thumbnail for Items whose image came from a cover choice or metadata preview rather
/// than an uploaded image.
/// </summary>
public sealed record CollectionItemEntryDto(
    long ItemId,
    string Url,
    string? Title,
    string? Memo,
    DateTimeOffset AddedAtUtc,
    int SortOrder,
    RepresentativeImageDto? RepresentativeImage,
    string? PreviewImageUrl,
    RepresentativeImageDto? CoverImage,
    // False for an Item another member owns: then Memo, RepresentativeImage and CoverImage are
    // always null (private to the Item's owner - they are never even selected from the database);
    // only Url/Title/automatic PreviewImageUrl/AddedAtUtc are shared.
    bool IsMine = true,
    // Who put this link into this Collection, as the caller may see them (see CollectionItemAdderDto).
    CollectionItemAdderDto? AddedBy = null);

/// <summary>
/// Who added a link to a Collection, within what the caller may already see of the Collection's
/// people: Kind "me" (the caller); "owner" / "member" (the Owner or a current member - their public
/// Juple ID, display name and profile photo, the same identity the participant list already shows);
/// "publicLink" (added through the 모든 사용자 link by someone who is not a participant - never
/// identified, since holding the link does not make them visible to the Collection's people). Null
/// when the adder is none of these any more. IsCollectionOwner: the adder is this Collection's Owner
/// (also when that is the caller). Only ever in the signed-in member views - the public link's DTOs
/// never carry an adder at all.
/// </summary>
public sealed record CollectionItemAdderDto(
    string Kind,
    string? JupleId = null,
    string? DisplayName = null,
    string? ProfileImageUrl = null,
    string? ProfileImageVersion = null,
    bool IsCollectionOwner = false);

public static class CollectionItemAdderKinds
{
    public const string Me = "me";
    public const string Owner = "owner";
    public const string Member = "member";
    public const string PublicLink = "publicLink";
}

/// <summary>
/// Read-only view of one link inside a Collection, for a member opening someone else's Item (the
/// owner-only GET /items/{id} stays owner-only). Never carries Memo or uploaded photos.
/// </summary>
public sealed record SharedCollectionItemDto(
    long ItemId,
    string Url,
    string? Title,
    string? PreviewImageUrl,
    DateTimeOffset AddedAtUtc,
    bool IsMine,
    CollectionItemAdderDto? AddedBy = null);
