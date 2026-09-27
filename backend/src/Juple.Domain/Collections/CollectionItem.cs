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

    public CollectionItem(
        long collectionId,
        long itemId,
        long addedByUserId,
        DateTimeOffset addedAtUtc,
        int sortOrder,
        bool addedViaPublicShare = false)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        AddedByUserId = addedByUserId;
        AddedAtUtc = addedAtUtc;
        SortOrder = sortOrder;
        AddedViaPublicShare = addedViaPublicShare;
    }

    /// <summary>
    /// Added through a writable public share link by a signed-in holder (not a member). Such a
    /// link is published on the public page next to the Owner's own - its adder chose a public
    /// Collection - but only its public-safe fields (title, URL, automatic preview image).
    /// </summary>
    public bool AddedViaPublicShare { get; private set; }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    /// <summary>
    /// Who put this Item into this Collection - the caller of the add, not necessarily the Item's
    /// owner in principle (kept separate from Item.UserId on purpose). Removing a Contributor
    /// removes exactly the associations they added (see CollectionCollaboratorStore).
    /// Every association this code creates sets it. During a rolling deployment (between the expand
    /// migration AddCollectionCollaborationAndLocking and the contract migration
    /// FinalizeCollectionCollaborationRequiredFields) a row inserted by the previous API revision
    /// temporarily holds 0 - never a real user, so it matches no "added by this user" filter - and
    /// is always an Owner-added association, which the contract migration then records as such.
    /// </summary>
    public long AddedByUserId { get; private set; }

    public DateTimeOffset AddedAtUtc { get; private set; }

    public int SortOrder { get; private set; }

    public void SetSortOrder(int sortOrder)
    {
        SortOrder = sortOrder;
    }
}
