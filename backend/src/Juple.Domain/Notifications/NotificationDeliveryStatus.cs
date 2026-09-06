namespace Juple.Domain.Notifications;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values. Mirrors Juple.Domain.Notifications.
/// NotificationType's identical convention.
/// </summary>
public enum NotificationDeliveryStatus : byte
{
    Sent = 0,
    Failed = 1,

    /// <summary>
    /// A dispatcher has atomically claimed this (Notification, PushDeviceRegistration) pair and is
    /// about to call the transport - see NotificationDeliveryStore.TryClaimAsync. Only a row with no
    /// existing delivery, or one currently Failed, can be claimed into this state; a row already
    /// Sending or Sent can never be claimed again, which is what prevents two concurrent dispatch
    /// passes from both sending the same Push. If a process crashes after claiming but before
    /// recording a final Sent/Failed outcome, the row is left Sending indefinitely - an accepted
    /// at-least-once/duplicate-minimization tradeoff (see this feature's own design notes), not a
    /// staleness/lease timeout this stage implements.
    /// </summary>
    Sending = 2,
}
