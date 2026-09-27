using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.RemoveItemFromCollection;

/// <summary>Owner only (RemoveItem), and for a locked Collection a valid unlock grant - the lock protects content changes too.</summary>
public sealed class RemoveItemFromCollectionService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    ISocialNotificationPublisher? notifications = null) : IRemoveItemFromCollectionService
{
    public async Task RemoveAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireUnlockedAsync(userId, collectionId, CollectionPermission.RemoveItem, unlockToken, cancellationToken);
        await collectionItemStore.RemoveAsync(userId, collectionId, itemId, cancellationToken);
        if (notifications is not null)
        {
            await notifications.CollectionsChangedAsync(userId, [collectionId], cancellationToken);
        }
    }
}
