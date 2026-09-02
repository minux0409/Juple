namespace Juple.Domain.Purchases;

/// <summary>
/// A user's setting to repeatedly buy something on an interval - independent of Item (ItemId is
/// optional and detached, never cascaded away, if the referenced Item is later deleted, mirroring
/// Purchase's identical ItemId handling) and independent of any specific Purchase row (a Purchase's
/// RepeatPurchaseId is likewise detached, never cascaded, if this RepeatPurchase is later deleted).
/// ProductName is required for the same reason it is on Purchase: it is the only guaranteed way to
/// know what this setting is for once ItemId is null, whether from the start or after the Item was
/// deleted - callers must pass an already-trimmed, non-empty value.
///
/// NextPurchaseDate is the current schedule's authoritative date - this type only stores it, it
/// never computes or advances it; that responsibility belongs to the Application layer once it
/// exists. Domain/DB model only for now: no Update method yet, since no Application service calls
/// one in this commit.
/// </summary>
public sealed class RepeatPurchase
{
    private RepeatPurchase()
    {
    }

    public RepeatPurchase(
        long userId,
        long? itemId,
        string productName,
        int intervalValue,
        IntervalUnit intervalUnit,
        DateOnly nextPurchaseDate,
        bool isReminderEnabled,
        int reminderLeadDays,
        bool isEnabled,
        DateTimeOffset createdAtUtc,
        DateTimeOffset updatedAtUtc)
    {
        UserId = userId;
        ItemId = itemId;
        ProductName = productName;
        IntervalValue = intervalValue;
        IntervalUnit = intervalUnit;
        NextPurchaseDate = nextPurchaseDate;
        IsReminderEnabled = isReminderEnabled;
        ReminderLeadDays = reminderLeadDays;
        IsEnabled = isEnabled;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = updatedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public long? ItemId { get; private set; }

    public string ProductName { get; private set; } = null!;

    public int IntervalValue { get; private set; }

    public IntervalUnit IntervalUnit { get; private set; }

    public DateOnly NextPurchaseDate { get; private set; }

    public bool IsReminderEnabled { get; private set; }

    public int ReminderLeadDays { get; private set; }

    public bool IsEnabled { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];
}
