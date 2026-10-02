using Juple.Application.Notifications;

namespace Juple.Application.Items.RestoreItem;

public sealed class RestoreItemService(
    IItemLifecycleStore itemLifecycleStore,
    ISocialNotificationPublisher? notifications = null) : IRestoreItemService
{
    public async Task RestoreAsync(long userId, long itemId, CancellationToken cancellationToken = default)
    {
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        await itemLifecycleStore.RestoreAsync(userId, itemId, cancellationToken);
        if (notifications is not null)
        {
            await notifications.ItemCollectionsChangedAsync(userId, itemId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
    }
}
