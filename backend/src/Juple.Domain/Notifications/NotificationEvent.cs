namespace Juple.Domain.Notifications;

/// <summary>Where an outbox event is in its life. Persisted - values are fixed, add new ones at the end.</summary>
public enum NotificationEventStatus : byte
{
    /// <summary>Still to process (possibly waiting for its next retry - see NextAttemptAtUtc).</summary>
    Pending = 0,

    /// <summary>Every recipient's Notification row exists (or nobody was left to tell).</summary>
    Processed = 1,

    /// <summary>
    /// Can never be processed - a structurally impossible event (unknown type, missing ids). Terminal,
    /// recorded with a safe error code, visible to operations. A transient failure never ends here.
    /// </summary>
    FailedPermanent = 2,
}

/// <summary>
/// The durable outbox record of one notification-worthy event - written in the same SQL transaction
/// as the change that caused it, so the change and the intent to notify about it never come apart.
/// One row per logical event, never per recipient: a link added to a Collection with thousands of
/// members is ONE row here. Who exactly is told is decided later, asynchronously, by the notification
/// worker (or the recovery Job), which materializes the recipients' Notification rows page by page
/// (RecipientCursor) and hands them to Push delivery.
///
/// Only ids and counts - never a comment's text, a memo, a URL, a password or a Push token. The ids
/// are resolved to names/state at processing and send time, so later renames, deletions and access
/// changes are honored.
///
/// Processing: a processor claims a Pending, due (NextAttemptAtUtc) row by moving LeaseUntilUtc forward
/// in one conditional UPDATE (never a process-local lock), so a duplicate Service Bus message, two
/// worker replicas and the recovery Job never process it at once. A failed attempt schedules the next
/// one with a capped back-off - a transient failure is retried for as long as it takes, never given up
/// (RequiresAttention only flags a long run of failures for operations).
/// </summary>
public sealed class NotificationEvent
{
    public const int DedupKeyMaxLength = 120;

    public const int LastErrorCodeMaxLength = 64;

    private NotificationEvent()
    {
    }

    public NotificationEvent(
        NotificationType type,
        long? actorUserId,
        long? recipientUserId,
        long? collectionId,
        long? subjectId,
        int? itemCount,
        bool hideActor,
        long? skipUserId,
        string? dedupKey,
        DateTimeOffset createdAtUtc,
        long? itemId = null)
    {
        Type = type;
        ActorUserId = actorUserId;
        RecipientUserId = recipientUserId;
        CollectionId = collectionId;
        SubjectId = subjectId;
        ItemCount = itemCount;
        HideActor = hideActor;
        SkipUserId = skipUserId;
        ItemId = itemId;
        DedupKey = dedupKey;
        CreatedAtUtc = createdAtUtc;
        Status = NotificationEventStatus.Pending;
    }

    public long Id { get; private set; }

    /// <summary>The NotificationType of the Notification rows this event becomes.</summary>
    public NotificationType Type { get; private set; }

    /// <summary>Who caused it (never told about it themselves). Internal only - a proposal's or a public-link adder's identity never reaches the recipients.</summary>
    public long? ActorUserId { get; private set; }

    /// <summary>Set when the one recipient is already known at the time of the change (a friend request, an invitation, a proposal's result).</summary>
    public long? RecipientUserId { get; private set; }

    public long? CollectionId { get; private set; }

    /// <summary>What it is about, by type: a friendship, an invitation, an Item, a proposal.</summary>
    public long? SubjectId { get; private set; }

    public int? ItemCount { get; private set; }

    /// <summary>Added through the public link: the actor is never named to the recipients.</summary>
    public bool HideActor { get; private set; }

    /// <summary>
    /// The link a proposal's result (approved / declined) is about - the proposal row is gone by then, so
    /// the result's thumbnail needs it here. A plain id, no FK (the event must never block deleting the Item).
    /// </summary>
    public long? ItemId { get; private set; }

    /// <summary>One more person not to tell (the Owner who approved a proposal).</summary>
    public long? SkipUserId { get; private set; }

    /// <summary>
    /// Makes recording the event idempotent - see NotificationEventKeys for the two kinds: a business
    /// object's own id (that object can cause this event once) or a coalescing time bucket (repeats
    /// within the window are one event; the next window is a new key, so it never blocks a later one).
    /// </summary>
    public string? DedupKey { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public NotificationEventStatus Status { get; private set; }

    /// <summary>When the event left Pending (Processed or FailedPermanent) - for retention.</summary>
    public DateTimeOffset? CompletedAtUtc { get; private set; }

    /// <summary>A processor owns the row until then; an expired lease (a crashed processor) can be taken over.</summary>
    public DateTimeOffset? LeaseUntilUtc { get; private set; }

    /// <summary>Not before then (retry back-off); null = due now.</summary>
    public DateTimeOffset? NextAttemptAtUtc { get; private set; }

    public DateTimeOffset? LastAttemptAtUtc { get; private set; }

    /// <summary>How many times processing was started - drives the back-off, never a give-up.</summary>
    public int AttemptCount { get; private set; }

    /// <summary>Many attempts failed in a row - for operations to look at. Retrying continues regardless.</summary>
    public bool RequiresAttention { get; private set; }

    /// <summary>Keyset position of a paged fan-out: the last recipient UserId already materialized.</summary>
    public long? RecipientCursor { get; private set; }

    /// <summary>A short code for the last failure (an exception type, or why it is permanent) - never user content.</summary>
    public string? LastErrorCode { get; private set; }
}
