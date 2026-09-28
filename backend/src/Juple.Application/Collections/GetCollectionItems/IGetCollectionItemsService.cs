namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemsService
{
    /// <summary>
    /// Owner or Contributor; for a locked Collection also a valid unlock grant for this user
    /// (CollectionLockedException otherwise - nothing is returned before the password is proven).
    /// sort picks the order of the whole Collection (see CollectionItemSort); cursor must be one this
    /// same order issued.
    /// </summary>
    Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CollectionItemSort sort = CollectionItemSort.Manual,
        CancellationToken cancellationToken = default);

    /// <summary>Same gates; one link as the read-only shared view (null when not in this Collection).</summary>
    Task<SharedCollectionItemDto?> GetItemAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
