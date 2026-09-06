namespace Juple.Application.Notifications.MarkNotificationRead;

public interface IMarkNotificationReadService
{
    /// <summary>Throws NotificationNotFoundException for a missing/other-user notification.</summary>
    Task MarkReadAsync(long userId, long notificationId, CancellationToken cancellationToken = default);
}
