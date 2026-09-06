namespace Juple.Domain.Notifications;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values. Mirrors Juple.Domain.Purchases.IntervalUnit's
/// identical convention. Currently the only member - Notification is deliberately kept generic (see
/// that type) so a future Type can be added without a new table.
/// </summary>
public enum NotificationType : byte
{
    RepeatPurchaseDue = 0,
}
