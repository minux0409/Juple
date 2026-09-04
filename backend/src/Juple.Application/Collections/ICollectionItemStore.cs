using Juple.Application.Images;

namespace Juple.Application.Collections;

public interface ICollectionItemStore
{
    /// <summary>Throws CollectionNotFoundException when collectionId is missing or not owned by userId.</summary>
    Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages)> GetItemsAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Throws CollectionNotFoundException when collectionId is missing or not owned by userId, and
    /// ItemNotFoundException when itemId is missing or not owned by userId - mirrors
    /// AssignItemCategoryService's cross-ownership check. A no-op (success) when the Item is
    /// already in the Collection - this is a "set membership" write, not a strict create, so a
    /// repeat add is never a conflict (matches Item.MoveToWishlist's own already-there no-op).
    /// </summary>
    Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        DateTimeOffset addedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Fully idempotent, mirroring DeleteCategoryAsync/DeleteItemAsync: a missing/other-user's
    /// Collection, a missing/foreign Item, or an already-absent membership all complete without
    /// error - the desired end state ("this Item is not in this Collection") was already reached.
    /// </summary>
    Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default);
}
