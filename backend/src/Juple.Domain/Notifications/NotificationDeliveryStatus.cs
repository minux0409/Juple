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
    /// about to call the transport - see NotificationDeliveryStore.TryClaimAsync. A row with no
    /// existing delivery, one currently Failed, or one Sending whose AttemptedAtUtc lease has passed
    /// NotificationDeliveryStore.StaleSendingLeaseTimeout (15 minutes) can be claimed into this
    /// state; a Sent row, or a Sending row still within its lease, can never be claimed again - this
    /// is what prevents two concurrent dispatch passes from both sending the same Push. If a process
    /// crashes after claiming but before recording a final Sent/Failed outcome, the row stays
    /// Sending only until the lease expires, at which point the next dispatch pass reclaims it -
    /// an accepted at-least-once/duplicate-minimization tradeoff (see this feature's own design
    /// notes), not a lost Push.
    /// </summary>
    Sending = 2,
}
