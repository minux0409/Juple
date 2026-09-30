using Juple.Application.Images;

namespace Juple.Application.Collections;

public interface ICollectionItemStore
{
    /// <summary>Throws CollectionNotFoundException when collectionId is missing or not owned by userId. Each returned CollectionItemEntryDto.RepresentativeImage/CoverImage is always null - the actual signed read URL is resolved by GetCollectionItemsService from RepresentativeImages/CoverImages afterward (same split as IItemHistoryQueryStore). PreviewImageUrl (an external URL, not a Blob) is already fully populated on each CollectionItemEntryDto.</summary>
    /// <summary>
    /// Every active Item in a Collection the viewer owns or collaborates on (re-checked here, so a
    /// missing access check upstream still fails closed). Private fields (Memo, uploaded/cover image
    /// refs) are selected only for the viewer's own Items.
    /// </summary>
    /// <remarks>
    /// sort picks the order (Manual when omitted - the original contract); cursor must belong to that
    /// same order (ArgumentException otherwise).
    /// </remarks>
    Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort = CollectionItemSort.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// GetItemsAsync restricted to links added (AddedAtUtc) within [fromUtc, toUtc) - one date
    /// section of the Collection (see GetCollectionItemSectionsService). Same access check, rows,
    /// order and keyset cursor; a cursor from this window only ever continues inside it. Defaulted:
    /// only CollectionStore implements the sectioned view.
    /// </summary>
    Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsInRangeAsync(
        long userId,
        long collectionId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>
    /// The AddedAtUtc of the Collection's oldest active link added before beforeUtc (null: none).
    /// Same access check as GetItemsAsync. Defaulted like GetItemsInRangeAsync.
    /// </summary>
    Task<DateTimeOffset?> GetOldestAddedAtUtcAsync(
        long userId,
        long collectionId,
        DateTimeOffset beforeUtc,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>
    /// For each [FromUtc, ToUtc) window, how many active links GetItemsInRangeAsync pages through in
    /// it - in one statement (never one query per window). Same access check as GetItemsAsync.
    /// </summary>
    Task<IReadOnlyList<int>> CountByAddedRangesAsync(
        long userId,
        long collectionId,
        IReadOnlyList<(DateTimeOffset FromUtc, DateTimeOffset ToUtc)> ranges,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    /// <summary>
    /// Throws CollectionNotFoundException when collectionId is missing or not owned by userId, and
    /// ItemNotFoundException when itemId is missing or not owned by userId - mirrors
    /// AssignItemCategoryService's cross-ownership check. A no-op (success) when the Item is
    /// already in the Collection - this is a "set membership" write, not a strict create, so a
    /// repeat add is never a conflict (matches Item.MoveToWishlist's own already-there no-op).
    /// </summary>
    /// <summary>One active Item of that Collection as the read-only shared view, or null.</summary>
    Task<SharedCollectionItemDto?> GetSharedItemAsync(
        long userId,
        long collectionId,
        long itemId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds the caller's OWN Item to a Collection they own or collaborate on, recording them as
    /// AddedByUserId. Someone else's Item is ItemNotFoundException, whatever the caller's role.
    /// True when this call added it; false when it was already in the Collection (a no-op).
    /// </summary>
    Task<bool> AddAsync(
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

    /// <summary>
    /// Moves itemId to immediately after afterItemId's current position (null afterItemId = move to
    /// the very front). Only the Collection's owner may reorder. Throws CollectionNotFoundException
    /// when collectionId is missing or not owned by userId, and ItemNotFoundException when itemId or
    /// a non-null afterItemId does not belong to this Collection. A no-op when afterItemId already
    /// equals itemId itself.
    /// </summary>
    Task MoveItemAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        CancellationToken cancellationToken = default);
}
