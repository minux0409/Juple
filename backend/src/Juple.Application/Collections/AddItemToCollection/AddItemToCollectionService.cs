using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.AddItemToCollection;

public sealed class AddItemToCollectionService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : IAddItemToCollectionService
{
    /// <summary>
    /// Owner or Contributor (AddItem), and for a locked Collection a valid unlock grant - adding a
    /// link changes the Collection's content, which the lock protects. The Item must be the
    /// caller's own (enforced by the store).
    /// </summary>
    public async Task AddAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.AddItem, unlockToken, cancellationToken);
        await collectionItemStore.AddAsync(userId, collectionId, itemId, timeProvider.GetUtcNow(), cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
        }
    }
}
