namespace Juple.Application.Collections;

/// <summary>
/// Keyset pagination position for a Collection's Item list. For the Manual order it is
/// (SortOrder ASC, ItemId ASC) - the owner's manual display order (see CollectionItem.SortOrder), not
/// insertion time. For a date order (see ForDate) it is (AddedAtUtc, ItemId) in that order's
/// direction; ItemId is unique within a Collection, so links added at the same instant still page
/// without duplicates or gaps. A cursor always names the order it belongs to (Sort) and is only
/// valid for that same order. Carries no authorization information - callers still filter by the
/// owning Collection/UserId independently.
/// </summary>
public sealed record CollectionItemPageCursor(int SortOrder, long ItemId)
{
    public CollectionItemSort Sort { get; init; } = CollectionItemSort.Manual;

    /// <summary>Date orders only: the AddedAtUtc of the last link on the previous page.</summary>
    public DateTimeOffset AddedAtUtc { get; init; }

    public static CollectionItemPageCursor ForDate(CollectionItemSort sort, DateTimeOffset addedAtUtc, long itemId) =>
        sort is CollectionItemSort.DateDesc or CollectionItemSort.DateAsc
            ? new CollectionItemPageCursor(0, itemId) { Sort = sort, AddedAtUtc = addedAtUtc }
            : throw new ArgumentOutOfRangeException(nameof(sort), sort, "Only a date order has a date cursor.");
}
