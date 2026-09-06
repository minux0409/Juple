using Juple.Domain.Notifications;

namespace Juple.Api.Notifications;

/// <summary>
/// Converts the Domain <see cref="NotificationType"/> enum to its lowerCamelCase wire value. The
/// numeric DB/enum value is never exposed on the API. One-way only - Mobile never creates or edits
/// a Notification's Type, it only ever reads one (mirrors the read-only half of
/// IntervalUnitWireFormat's shape, minus the parse direction that type needs and this one does not).
/// </summary>
public static class NotificationTypeWireFormat
{
    public static string ToWireValue(NotificationType type) => type switch
    {
        NotificationType.RepeatPurchaseDue => "repeatPurchaseDue",
        _ => throw new ArgumentOutOfRangeException(nameof(type), type, "Unknown NotificationType."),
    };
}
