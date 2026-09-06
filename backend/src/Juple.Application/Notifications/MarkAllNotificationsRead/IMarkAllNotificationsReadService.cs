namespace Juple.Application.Notifications.MarkAllNotificationsRead;

public interface IMarkAllNotificationsReadService
{
    Task MarkAllReadAsync(long userId, CancellationToken cancellationToken = default);
}
