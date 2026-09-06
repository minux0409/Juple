namespace Juple.Application.Notifications;

public interface INotificationStore
{
    /// <summary>
    /// Computes the user's local "today" from timeZoneId (see DailyInboxDateRangeCalculator.
    /// GetLocalDate) and materializes one Notification per enabled RepeatPurchase whose
    /// NextPurchaseDate is on or before that date, unless a Notification for that exact
    /// (RepeatPurchaseId, DueDate) already exists. Safe to call repeatedly and from concurrent
    /// requests - never creates a duplicate for the same due cycle (see
    /// UX_Notifications_RepeatPurchaseId_DueDate). Intended to be called before every read
    /// (ListAsync/GetUnreadCountAsync) so the inbox is always current without a background worker;
    /// a future Push worker can call this exact same method to materialize before sending.
    /// </summary>
    Task MaterializeDueAsync(
        long userId, string timeZoneId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task<NotificationPage> ListAsync(
        long userId, NotificationPageCursor? cursor, int limit, CancellationToken cancellationToken = default);

    Task<int> GetUnreadCountAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Throws NotificationNotFoundException for a missing/other-user notification. Idempotent -
    /// marking an already-read notification again succeeds without changing ReadAtUtc.
    /// </summary>
    Task MarkReadAsync(
        long userId, long notificationId, DateTimeOffset readAtUtc, CancellationToken cancellationToken = default);

    /// <summary>Idempotent - marks every currently-unread notification for userId as read; a no-op when none are unread.</summary>
    Task MarkAllReadAsync(long userId, DateTimeOffset readAtUtc, CancellationToken cancellationToken = default);
}
