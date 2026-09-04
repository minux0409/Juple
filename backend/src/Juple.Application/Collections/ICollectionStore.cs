namespace Juple.Application.Collections;

public interface ICollectionStore
{
    /// <summary>
    /// Cursor-paginated (SavedAtUtc-style unbounded growth over time, same as History/Purchases) -
    /// never returns the whole list in one response. itemId/excludeItemId are mutually exclusive
    /// filters (callers - see CollectionsController - must reject both being set; this method does
    /// not itself enforce that) with opposite meanings: itemId restricts to Collections that
    /// already contain that Item (powers ItemDetails' membership chip list); excludeItemId
    /// restricts to Collections that do NOT yet contain that Item (powers the "add to collection"
    /// modal, so a Collection the Item already belongs to can never resurface as a candidate no
    /// matter which page is loaded - unlike client-side filtering against a separately-paginated
    /// membership list, which can miss pages). Either filter is a filter on the caller's own
    /// Collections, not a primary resource lookup - the same style as GetPurchases' itemId query
    /// param (see PurchasesQueryParameters): a missing/other-user's Item simply matches
    /// everything/nothing rather than throwing. Both filters compose with the same cursor-paginated
    /// CreatedAtUtc DESC, Id DESC ordering, never a separate contract.
    /// </summary>
    Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    Task<CollectionDto> CreateAsync(
        long userId,
        string name,
        string nameNormalized,
        DateTimeOffset createdAtUtc,
        CancellationToken cancellationToken = default);

    Task<CollectionDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task RenameAsync(
        long userId,
        long collectionId,
        string name,
        string nameNormalized,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A missing or other-user's Collection is treated as already deleted and completes without
    /// error. Removes only this Collection and its CollectionItem membership rows (via cascade) -
    /// never the Items themselves.
    /// </summary>
    Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
