using Juple.Application.Images;

namespace Juple.Application.Items;

public interface IItemTrashQueryStore
{
    /// <summary>
    /// The caller's most-recently-deleted Items first, capped at limit (the caller/Application
    /// service always passes ItemTrashLimits.ListLimit - never a client-supplied
    /// value). RepresentativeImages/CoverImages mirror IItemHistoryQueryStore.GetHistoryAsync's own
    /// shape - raw BlobName refs the Application service resolves to a read URL, never returned
    /// as-is to a Controller.
    /// </summary>
    Task<(IReadOnlyList<ItemTrashEntryDto> Items, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> ListTrashAsync(
        long userId,
        int limit,
        CancellationToken cancellationToken = default);
}
