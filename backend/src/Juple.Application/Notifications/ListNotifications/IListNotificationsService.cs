namespace Juple.Application.Notifications.ListNotifications;

public interface IListNotificationsService
{
    Task<NotificationPage> ListAsync(
        long userId,
        string timeZoneId,
        NotificationPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
