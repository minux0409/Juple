using Juple.Application.Images;

namespace Juple.Application.Items;

public interface IItemDetailQueryStore
{
    /// <summary>
    /// Returns (null, null, null) when no Item with this Id is owned by this UserId. Details.
    /// RepresentativeImage/CoverImage are always null here - the raw BlobName refs (not yet
    /// resolved to a read url) are returned separately for the caller to resolve via
    /// IItemImageStorage. CoverImage is only non-null when the Item's CoverImageId is set AND
    /// still references an existing ItemImage of this same Item.
    /// </summary>
    Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage, ItemRepresentativeImageRef? CoverImage)> GetDetailsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
