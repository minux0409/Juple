namespace Juple.Application.Collections.GetCollectionItems;

public interface IGetCollectionItemsService
{
    /// <summary>
    /// Owner or Contributor; for a locked Collection also a valid unlock grant for this user
    /// (CollectionLockedException otherwise - nothing is returned before the password is proven).
    /// </summary>
    Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);

    /// <summary>Same gates; one link as the read-only shared view (null when not in this Collection).</summary>
    Task<SharedCollectionItemDto?> GetItemAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
