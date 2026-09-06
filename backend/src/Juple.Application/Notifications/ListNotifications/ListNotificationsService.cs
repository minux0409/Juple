namespace Juple.Application.Notifications.ListNotifications;

/// <summary>
/// Materializes any newly-due RepeatPurchase notifications before listing - see
/// INotificationStore.MaterializeDueAsync - so the inbox is always current without a background
/// scheduler.
/// </summary>
public sealed class ListNotificationsService(INotificationStore notificationStore, TimeProvider timeProvider)
    : IListNotificationsService
{
    public async Task<NotificationPage> ListAsync(
        long userId,
        string timeZoneId,
        NotificationPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        await notificationStore.MaterializeDueAsync(userId, timeZoneId, nowUtc, cancellationToken);
        return await notificationStore.ListAsync(userId, cursor, limit, cancellationToken);
    }
}
