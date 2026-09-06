namespace Juple.Application.Notifications.GetUnreadNotificationCount;

public interface IGetUnreadNotificationCountService
{
    Task<int> GetAsync(long userId, string timeZoneId, CancellationToken cancellationToken = default);
}
