using Juple.Application.Images;

namespace Juple.Application.Items;

public interface IItemDetailQueryStore
{
    /// <summary>
    /// Returns (null, null) when no Item with this Id is owned by this UserId. Details.
    /// RepresentativeImage is always null here - the raw BlobName ref (not yet resolved to a read
    /// url) is returned separately for the caller to resolve via IItemImageStorage.
    /// </summary>
    Task<(ItemDetailsDto? Details, ItemRepresentativeImageRef? RepresentativeImage)> GetDetailsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
