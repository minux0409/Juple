namespace Juple.Domain.Collections;

/// <summary>
/// Item membership in a Collection - a pure join row with no user-editable fields of its own beyond
/// SortOrder, so unlike Collection it carries no RowVersion (mirrors ItemImage; concurrent reorders
/// are instead serialized by a row lock on the parent Collection - see CollectionStore.MoveItemAsync).
/// A surrogate Id is the primary key (this project's convention - see database-conventions.md); the
/// (CollectionId, ItemId) uniqueness that prevents the same Item being added twice to the same
/// Collection is enforced by a separate unique index, not by making this pair the PK - see
/// CollectionItemConfiguration.
///
/// SortOrder is the owner's manual display order (ascending), sparse-spaced (not dense 0..N-1) so a
/// single reorder or a new prepend only ever needs to write one row - see CollectionStore for the
/// gap-based move/prepend logic and its self-healing renumber path. Deliberately unconstrained to
/// non-negative (unlike ItemImage.SortOrder), since a newly-added Item prepends via
/// `min(SortOrder) - gap`, which must be able to go negative over the Collection's lifetime.
/// </summary>
public sealed class CollectionItem
{
    private CollectionItem()
    {
    }

    public CollectionItem(long collectionId, long itemId, DateTimeOffset addedAtUtc, int sortOrder)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        AddedAtUtc = addedAtUtc;
        SortOrder = sortOrder;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    public DateTimeOffset AddedAtUtc { get; private set; }

    public int SortOrder { get; private set; }

    public void SetSortOrder(int sortOrder)
    {
        SortOrder = sortOrder;
    }
}
