namespace Juple.Application.Notifications.MarkAllNotificationsRead;

public sealed class MarkAllNotificationsReadService(INotificationStore notificationStore, TimeProvider timeProvider)
    : IMarkAllNotificationsReadService
{
    public Task MarkAllReadAsync(long userId, CancellationToken cancellationToken = default) =>
        notificationStore.MarkAllReadAsync(userId, timeProvider.GetUtcNow(), cancellationToken);
}
