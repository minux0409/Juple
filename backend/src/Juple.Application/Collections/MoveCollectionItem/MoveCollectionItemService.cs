using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.MoveCollectionItem;

/// <summary>
/// Reorder: Owner only - allowed in a collaborative Collection too - and for a locked Collection
/// only with a valid unlock grant (the Owner is not exempt from the lock).
/// </summary>
public sealed class MoveCollectionItemService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore) : IMoveCollectionItemService
{
    public async Task MoveAsync(
        long userId,
        long collectionId,
        long itemId,
        long? afterItemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.Reorganize, unlockToken, cancellationToken);
        await collectionItemStore.MoveItemAsync(userId, collectionId, itemId, afterItemId, cancellationToken);
    }
}
