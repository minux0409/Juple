namespace Juple.Domain.Collections;

/// <summary>
/// Item membership in a Collection - a pure join row with no user-editable fields of its own, so
/// unlike Collection it carries no RowVersion (create/delete only, mirrors ItemImage). A surrogate
/// Id is the primary key (this project's convention - see database-conventions.md); the
/// (CollectionId, ItemId) uniqueness that prevents the same Item being added twice to the same
/// Collection is enforced by a separate unique index, not by making this pair the PK - see
/// CollectionItemConfiguration.
/// </summary>
public sealed class CollectionItem
{
    private CollectionItem()
    {
    }

    public CollectionItem(long collectionId, long itemId, DateTimeOffset addedAtUtc)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        AddedAtUtc = addedAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    public DateTimeOffset AddedAtUtc { get; private set; }
}
