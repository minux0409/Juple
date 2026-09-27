using Juple.Domain.Collections;

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
    /// everything/nothing rather than throwing. isFavorite is an independent filter (the
    /// Collections list's "즐겨찾는 보관함" section) that freely composes with itemId/excludeItemId -
    /// unlike those two, it has no mutual-exclusivity rule. All filters compose with the same
    /// cursor-paginated CreatedAtUtc DESC, Id DESC ordering, never a separate contract.
    /// </summary>
    Task<CollectionPage> ListAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        bool? isFavorite,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Active Collections the caller is a Contributor of (never ones they own), each with
    /// AccessRole "contributor", the Owner's Juple ID and lock state. Same cursor/limit/filters as
    /// ListAsync except isFavorite (a Contributor has no favorite state).
    /// </summary>
    Task<CollectionPage> ListSharedAsync(
        long userId,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        // Same defaulted-member convention as RestoreAsync below - only CollectionStore implements
        // it; single-purpose test fakes of this interface need not.
        Task.FromResult(new CollectionPage([], null));

    /// <summary>
    /// One page of the caller's Collections in the given scope (see CollectionListScope), in a
    /// single ordering (CreatedAtUtc DESC, Id DESC) across owned and shared rows - so a mixed list
    /// is paged by the server, never merged by the client. Every row carries the caller's AccessRole,
    /// the caller's own IsFavorite and, for collaborative Collections, the participant summary.
    /// </summary>
    Task<CollectionPage> ListByScopeAsync(
        long userId,
        ListCollections.CollectionListScope scope,
        long? itemId,
        long? excludeItemId,
        CollectionPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        throw new NotSupportedException();

    Task<CollectionDto> CreateAsync(
        long userId,
        string name,
        string nameNormalized,
        CollectionIcon icon,
        DateTimeOffset createdAtUtc,
        string? color = null,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// An active Collection the caller owns or collaborates on (anyone else: CollectionNotFoundException).
    /// Metadata only - never item content - so a locked Collection's header is still available.
    /// </summary>
    Task<CollectionDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task RenameAsync(
        long userId,
        long collectionId,
        string name,
        string nameNormalized,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Sets or clears the CALLER's own favorite mark (see CollectionFavorite) on a Collection they
    /// can access - idempotent either way, and never visible to or affecting anyone else. Callers
    /// check access first (CollectionPermission.Favorite). Returns the Collection as the caller sees it.
    /// </summary>
    Task<CollectionDto> SetFavoriteAsync(
        long userId,
        long collectionId,
        bool isFavorite,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Same lost-update protection as SetFavoriteAsync above.</summary>
    Task<CollectionDto> SetIconAsync(
        long userId,
        long collectionId,
        CollectionIcon icon,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Same lost-update protection as SetFavoriteAsync above.</summary>
    Task<CollectionDto> SetColorAsync(
        long userId,
        long collectionId,
        string color,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// A missing or other-user's Collection is treated as already deleted and completes without
    /// error. Soft-deletes only this Collection; its memberships, share, and Items remain intact.
    /// </summary>
    Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default);

    Task RestoreAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        throw new CollectionNotFoundException();
}
