namespace Juple.Application.Notifications.GetUnreadNotificationCount;

/// <summary>Materializes due notifications first - see ListNotificationsService's identical reasoning.</summary>
public sealed class GetUnreadNotificationCountService(INotificationStore notificationStore, TimeProvider timeProvider)
    : IGetUnreadNotificationCountService
{
    public async Task<int> GetAsync(long userId, string timeZoneId, CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        await notificationStore.MaterializeDueAsync(userId, timeZoneId, nowUtc, cancellationToken);
        return await notificationStore.GetUnreadCountAsync(userId, cancellationToken);
    }
}
