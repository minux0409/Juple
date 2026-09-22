namespace Juple.Domain.Collections;

/// <summary>
/// Marks a single CollectionItem row (by its own surrogate Id, never by ItemId alone) as having
/// been created by a specific CollectionMergeOperation - the precise "which memberships did this
/// merge itself add to the Target" identity that Undo needs (see CollectionStore.UndoMergeAsync).
///
/// A plain snapshot of the source's ItemIds cannot answer this correctly once time passes: if the
/// user removes that membership and later re-adds the same Item to the Target themselves, the new
/// CollectionItem row gets a brand new Id (identity columns never reuse values - see
/// CollectionItemConfiguration), so this row's CollectionItemId simply stops matching anything and
/// Undo correctly leaves the user's own re-added membership alone. The FK to CollectionItem is
/// Cascade (unlike ItemSaveRequest's deliberately-not-a-FK ItemId - see its own remarks): once the
/// CollectionItem row itself is gone (removed by the user, or cascaded away with its Item/Collection),
/// this row has nothing left to describe and disappears with it, so Undo's join over still-live rows
/// never needs to separately check "does this membership still exist".
/// </summary>
public sealed class CollectionMergeCreatedMembership
{
    private CollectionMergeCreatedMembership()
    {
    }

    public CollectionMergeCreatedMembership(long mergeOperationId, long collectionItemId)
    {
        MergeOperationId = mergeOperationId;
        CollectionItemId = collectionItemId;
    }

    public long Id { get; private set; }

    public long MergeOperationId { get; private set; }

    public long CollectionItemId { get; private set; }
}
