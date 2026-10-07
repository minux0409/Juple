namespace Juple.Domain.Billing;

public enum StoreEventResult
{
    /// <summary>Received and persisted; not yet reconciled.</summary>
    Pending,

    /// <summary>Reconciled against the store: the purchase state is now current.</summary>
    Processed,

    /// <summary>The purchase could not be tied to any Juple account (and is not a known purchase): never guessed, kept for review.</summary>
    Unlinked,

    /// <summary>A notification type that carries nothing to reconcile (test, one-time products ...).</summary>
    Ignored,

    /// <summary>Retries were exhausted; needs an operator.</summary>
    FailedPermanent,
}

/// <summary>
/// A store notification (Google RTDN) as a DURABLE, idempotent work item: <c>(Source, ExternalEventId)</c> is unique, so a
/// duplicate or concurrent redelivery is the same event. It records only what is needed to reconcile - never the Pub/Sub
/// body, the Authorization header or the OIDC token - and carries the purchase token only SEALED and only until processing
/// has succeeded (the purchase row keeps the verification handle it needs). The notification is a trigger, never a claim:
/// nothing is ever granted from its type; processing re-fetches the authoritative state from the store.
/// </summary>
public sealed class StoreEvent
{
    private StoreEvent()
    {
    }

    public StoreEvent(StoreSource source, string externalEventId, string eventType, byte[]? tokenHash, byte[]? encryptedToken, DateTimeOffset receivedAtUtc)
    {
        Source = source;
        ExternalEventId = externalEventId;
        EventType = eventType;
        TokenHash = tokenHash;
        EncryptedToken = encryptedToken;
        ReceivedAtUtc = receivedAtUtc;
        NextAttemptAtUtc = receivedAtUtc;
        Result = StoreEventResult.Pending;
    }

    public long Id { get; private set; }

    public StoreSource Source { get; private set; }

    /// <summary>The Pub/Sub message id: the idempotency key.</summary>
    public string ExternalEventId { get; private set; } = null!;

    /// <summary>A normalized notification kind (for operators and metrics), e.g. "subscription:4" or "voided".</summary>
    public string EventType { get; private set; } = null!;

    public byte[]? TokenHash { get; private set; }

    public byte[]? EncryptedToken { get; private set; }

    public DateTimeOffset ReceivedAtUtc { get; private set; }

    /// <summary>When the wake-up signal reached the queue. Null = not (yet) signalled; the sweep recovers it.</summary>
    public DateTimeOffset? DispatchedAtUtc { get; private set; }

    public DateTimeOffset? ProcessedAtUtc { get; private set; }

    public int AttemptCount { get; private set; }

    /// <summary>The next time a processor may take this event; doubles as the lease while one holds it.</summary>
    public DateTimeOffset NextAttemptAtUtc { get; private set; }

    public StoreEventResult Result { get; private set; }

    public string? LastErrorCode { get; private set; }

    public void MarkDispatched(DateTimeOffset nowUtc) => DispatchedAtUtc ??= nowUtc;

    public void Complete(StoreEventResult result, DateTimeOffset nowUtc)
    {
        Result = result;
        ProcessedAtUtc = nowUtc;
        LastErrorCode = null;
        // The purchase row now holds whatever verification handle is needed.
        EncryptedToken = null;
    }

    public void Fail(string errorCode, DateTimeOffset nextAttemptAtUtc, bool permanent, DateTimeOffset nowUtc)
    {
        AttemptCount++;
        LastErrorCode = errorCode;
        NextAttemptAtUtc = nextAttemptAtUtc;
        if (permanent)
        {
            Result = StoreEventResult.FailedPermanent;
            ProcessedAtUtc = nowUtc;
            EncryptedToken = null;
        }
    }
}
