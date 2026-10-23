namespace Juple.Application.Push;

/// <summary>
/// The full Push message for one send. Title/Body null means a data-only message (no system-tray
/// notification - Mobile only refreshes what is on screen). Data carries ids only - never a memo,
/// a private friend note, a link, a password or a token. BadgeCount is the recipient's unanswered
/// requests (Android launchers that support it show it; the in-app badges stay the source of truth).
/// ExpiresAtUtc is when the message stops being worth delivering (the notification type's MaxAge after it was created): APNs keeps an
/// undelivered message for an offline phone until then, never longer. FCM does not use it.
/// OccurredAtUtc is when the notification was created (Notification.CreatedAtUtc): the time Android shows on the tray entry (FCM
/// android.notification.event_time). Null = the send time.
/// </summary>
public sealed record PushNotificationPayload(
    string? Title,
    string? Body,
    string Type,
    long NotificationId,
    IReadOnlyDictionary<string, string> Data,
    int? BadgeCount,
    DateTimeOffset? ExpiresAtUtc = null,
    DateTimeOffset? OccurredAtUtc = null);
