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
    RepresentativeImageDto? CoverImage);
