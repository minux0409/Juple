namespace Juple.Domain.Items;

/// <summary>
/// Tracks the last time a user opened one of their own saved Item's original URL (My Page →
/// "최근 본 링크" / Recently opened links) - never a click-analytics event log. At most one row per
/// (UserId, ItemId): opening the same Item again updates <see cref="LastOpenedAtUtc"/> in place
/// rather than adding another row (see RecentlyOpenedItemConfiguration's unique index and
/// RecentlyOpenedItemStore.RecordOpenAsync). Deliberately carries no OpenCount or any other
/// analytics field - this is account data the user can delete, not usage telemetry.
/// </summary>
public sealed class RecentlyOpenedItem
{
    private RecentlyOpenedItem()
    {
    }

    public RecentlyOpenedItem(long userId, long itemId, DateTimeOffset openedAtUtc)
    {
        UserId = userId;
        ItemId = itemId;
        LastOpenedAtUtc = openedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public long ItemId { get; private set; }

    public DateTimeOffset LastOpenedAtUtc { get; private set; }

    /// <summary>
    /// Advances LastOpenedAtUtc to whichever of the current value or openedAtUtc is later - never
    /// regresses it, in case an out-of-order/racing open event applies after a more recent one.
    /// </summary>
    public void Touch(DateTimeOffset openedAtUtc)
    {
        if (openedAtUtc <= LastOpenedAtUtc)
        {
            return;
        }

        LastOpenedAtUtc = openedAtUtc;
    }
}
