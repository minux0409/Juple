namespace Juple.Application.Notifications.MarkNotificationRead;

public sealed class MarkNotificationReadService(INotificationStore notificationStore, TimeProvider timeProvider)
    : IMarkNotificationReadService
{
    public Task MarkReadAsync(long userId, long notificationId, CancellationToken cancellationToken = default) =>
        notificationStore.MarkReadAsync(userId, notificationId, timeProvider.GetUtcNow(), cancellationToken);
}
