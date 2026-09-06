namespace Juple.Domain.Notifications;

/// <summary>
/// A Push delivery attempt for one Notification targeted at one PushDeviceRegistration - purely a
/// dispatch idempotency/retry record, never the user-facing notification itself (that stays
/// Notification, unaffected by anything in this type). At most one row exists per (NotificationId,
/// PushDeviceRegistrationId) pair (see NotificationDeliveryConfiguration's unique index): a retry
/// updates this same row's AttemptedAtUtc/Status rather than inserting another, so this table never
/// grows per-retry and a crashed/duplicate dispatch pass can never double-send.
///
/// A missing row for a given (NotificationId, PushDeviceRegistrationId) pair means "not yet
/// attempted" - the dispatch worker's candidate query is exactly that NOT EXISTS check.
///
/// AttemptedAtUtc doubles as this row's lease clock while Status is Sending (see
/// NotificationDeliveryStore.TryClaimAsync) - it is the moment the current claim was taken, not
/// merely "the last time someone tried." A Sending row whose AttemptedAtUtc is older than the
/// store's stale-lease timeout is understood to have lost its claimer (most likely a crash between
/// claiming and recording a final outcome) and becomes reclaimable again - this is what keeps a
/// crashed dispatch from permanently losing a Push, at the accepted cost of a possible duplicate
/// send if the original claimer actually finished sending but crashed before recording it (see
/// TryClaimAsync's own remarks - an accepted at-least-once tradeoff, not a bug).
/// </summary>
public sealed class NotificationDelivery
{
    private NotificationDelivery()
    {
    }

    public NotificationDelivery(
        long notificationId,
        long pushDeviceRegistrationId,
        NotificationDeliveryStatus status,
        int attemptCount,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode)
    {
        NotificationId = notificationId;
        PushDeviceRegistrationId = pushDeviceRegistrationId;
        Status = status;
        AttemptCount = attemptCount;
        AttemptedAtUtc = attemptedAtUtc;
        ProviderMessageId = providerMessageId;
        FailureCode = failureCode;
    }

    public long Id { get; private set; }

    public long NotificationId { get; private set; }

    public long PushDeviceRegistrationId { get; private set; }

    public NotificationDeliveryStatus Status { get; private set; }

    /// <summary>How many times this pair has been claimed into Sending - incremented only by TryClaimAsync, never by RecordAttempt. Observability/debugging only; nothing in this feature branches on its value.</summary>
    public int AttemptCount { get; private set; }

    public DateTimeOffset AttemptedAtUtc { get; private set; }

    public string? ProviderMessageId { get; private set; }

    public string? FailureCode { get; private set; }

    /// <summary>Records a claimed attempt's final outcome (Sent/Failed) against this same row - see this type's own remarks for why a retry never inserts a new row. Never changes AttemptCount - only the claim that led here already did.</summary>
    public void RecordAttempt(
        NotificationDeliveryStatus status,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode)
    {
        Status = status;
        AttemptedAtUtc = attemptedAtUtc;
        ProviderMessageId = providerMessageId;
        FailureCode = failureCode;
    }
}
