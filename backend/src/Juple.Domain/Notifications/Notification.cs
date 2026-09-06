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

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public NotificationType Type { get; private set; }

    public long? RepeatPurchaseId { get; private set; }

    public long? ItemId { get; private set; }

    public string? ProductNameSnapshot { get; private set; }

    public DateOnly? DueDate { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? ReadAtUtc { get; private set; }

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
