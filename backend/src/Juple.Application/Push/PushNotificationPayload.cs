namespace Juple.Application.Push;

/// <summary>
/// The full Push message for one send. Title/Body null means a data-only message (no system-tray
/// notification - Mobile only refreshes what is on screen). Data carries ids only - never a memo,
/// a private friend note, a link, a password or a token. BadgeCount is the recipient's unanswered
/// requests (Android launchers that support it show it; the in-app badges stay the source of truth).
/// </summary>
public sealed record PushNotificationPayload(
    string? Title,
    string? Body,
    string Type,
    long NotificationId,
    IReadOnlyDictionary<string, string> Data,
    int? BadgeCount);
