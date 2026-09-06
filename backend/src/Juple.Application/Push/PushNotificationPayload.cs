namespace Juple.Application.Push;

/// <summary>
/// The full Push message for one send - both the visible notification (title/body, for a
/// system-tray display while the app is backgrounded/terminated) and the minimal data payload
/// Mobile's tap handler reads to navigate (see PushTapPayload on the Mobile side). Deliberately
/// carries nothing beyond ids/a display name snapshot - never memo/amount/other private fields
/// (see this feature's own security requirements).
/// </summary>
public sealed record PushNotificationPayload(
    string Title,
    string Body,
    string Type,
    long NotificationId,
    long? RepeatPurchaseId,
    long? ItemId);
