using Juple.Application.Images;
using Juple.Domain.Items;

namespace Juple.Application.Items;

public interface IItemQueryStore
{
    /// <summary>
    /// When categoryId is set, the caller must own that Category - an other-user or missing
    /// Category throws CategoryNotFoundException rather than silently returning no Items.
    /// Each returned ItemListEntryDto.RepresentativeImage is always null here - representative
    /// images are keyed by Item Id in the second tuple element (raw BlobName refs, not yet
    /// resolved to a read URL) for the caller to resolve via IItemImageStorage.
    /// </summary>
    Task<(ItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetByStateAsync(
        long userId,
        ItemState state,
        long? categoryId,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
