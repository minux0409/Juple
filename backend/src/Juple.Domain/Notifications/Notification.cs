namespace Juple.Domain.Notifications;

/// <summary>
/// A user's in-app notification inbox row - never a Push delivery log and never analytics. Fields
/// beyond UserId/Type/CreatedAtUtc/ReadAtUtc are all optional because Type is meant to grow beyond
/// RepeatPurchaseDue later without every future Type needing every column.
///
/// For RepeatPurchaseDue (today's only Type): RepeatPurchaseId/ProductNameSnapshot/DueDate are
/// always present. ProductNameSnapshot is a snapshot of RepeatPurchase.ProductName at the moment
/// this notification was materialized - never re-read live from RepeatPurchase - so a later rename
/// there does not silently rewrite this row's own history. DueDate is the RepeatPurchase's
/// NextPurchaseDate at that same moment; together with RepeatPurchaseId it identifies the specific
/// due cycle this notification is for (see NotificationConfiguration's unique index) - once
/// NextPurchaseDate advances past this DueDate (see RepeatPurchase.RecordPurchase), a later due
/// cycle can materialize its own, separate Notification row.
///
/// ItemId is a live FK (SET NULL on Item delete, mirroring Purchase/RepeatPurchase's own ItemId
/// handling) since it exists only to deep-link Mobile to ItemDetails, not to decide anything about
/// materialization or read state.
/// </summary>
public sealed class Notification
{
    private Notification()
    {
    }

    public Notification(
        long userId,
        NotificationType type,
        long? repeatPurchaseId,
        long? itemId,
        string? productNameSnapshot,
        DateOnly? dueDate,
        DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        Type = type;
        RepeatPurchaseId = repeatPurchaseId;
        ItemId = itemId;
        ProductNameSnapshot = productNameSnapshot;
        DueDate = dueDate;
        CreatedAtUtc = createdAtUtc;
    }

    /// <summary>
    /// A social event for the Push outbox (see NotificationType 1-5). Only ids are stored - the
    /// actor's display name and the Collection's name are read when the Push is sent, so a renamed
    /// Collection or a changed display name is never frozen here and nothing private is copied.
    /// DedupKey makes the same event enqueue at most once (see NotificationConfiguration).
    /// </summary>
    public static Notification Social(
        long userId,
        NotificationType type,
        long? actorUserId,
        long? collectionId,
        long? subjectId,
        string dedupKey,
        DateTimeOffset createdAtUtc,
        int? itemCount = null) =>
        new(userId, type, null, null, null, null, createdAtUtc)
        {
            ActorUserId = actorUserId,
            CollectionId = collectionId,
            SubjectId = subjectId,
            DedupKey = dedupKey,
            ItemCount = itemCount,
        };

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public NotificationType Type { get; private set; }

    public long? RepeatPurchaseId { get; private set; }

    public long? ItemId { get; private set; }

    public string? ProductNameSnapshot { get; private set; }

    public DateOnly? DueDate { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? ReadAtUtc { get; private set; }

    /// <summary>Who caused a social notification (never shown as an id - only their display name/Juple ID).</summary>
    public long? ActorUserId { get; private set; }

    public long? CollectionId { get; private set; }

    /// <summary>The friend request (Friendship) or Collection invitation a social notification is about.</summary>
    public long? SubjectId { get; private set; }

    /// <summary>How many links one CollectionItemsAdded operation added (only that Type sets it).</summary>
    public int? ItemCount { get; private set; }

    public string? DedupKey { get; private set; }

    /// <summary>When the Push dispatcher finished with this row (sent, skipped as no longer relevant, or expired).</summary>
    public DateTimeOffset? DispatchedAtUtc { get; private set; }

    public void MarkDispatched(DateTimeOffset dispatchedAtUtc) => DispatchedAtUtc ??= dispatchedAtUtc;

    /// <summary>Idempotent - marking an already-read notification again leaves ReadAtUtc untouched.</summary>
    public void MarkRead(DateTimeOffset readAtUtc)
    {
        if (ReadAtUtc is not null)
        {
            return;
        }

        ReadAtUtc = readAtUtc;
    }
}
