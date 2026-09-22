namespace Juple.Domain.Collections;

/// <summary>
/// Server-owned record of a single Collection Merge, created inside the same transaction as the
/// merge itself (see CollectionStore.MergeAsync) so Undo never has to trust client-supplied
/// membership state. <see cref="OperationToken"/> is the opaque value returned to the client as
/// "undoOperationId" (see MergeCollectionsResult) - <see cref="Id"/> itself is never exposed,
/// matching this project's convention of a `long` internal PK plus a separate public-facing token
/// for Aggregates that need one (see database-conventions.md, mirrors ItemSaveRequest.ClientRequestId).
///
/// Which CollectionItem rows this specific merge created in the Target is tracked by
/// CollectionMergeCreatedMembership, not by this row - see its own remarks for why a plain ItemId
/// snapshot cannot correctly identify "created by this merge" once rows can be removed and re-added.
/// </summary>
public sealed class CollectionMergeOperation
{
    private CollectionMergeOperation()
    {
    }

    public CollectionMergeOperation(
        long userId,
        Guid operationToken,
        long sourceCollectionId,
        long targetCollectionId,
        DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        OperationToken = operationToken;
        SourceCollectionId = sourceCollectionId;
        TargetCollectionId = targetCollectionId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public Guid OperationToken { get; private set; }

    public long SourceCollectionId { get; private set; }

    public long TargetCollectionId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? UndoneAtUtc { get; private set; }

    /// <summary>Idempotent - marking an already-undone operation again is a no-op, so a retried Undo
    /// request can never re-run the restore/cleanup a first successful call already did.</summary>
    public void MarkUndone(DateTimeOffset undoneAtUtc)
    {
        if (UndoneAtUtc is null)
        {
            UndoneAtUtc = undoneAtUtc;
        }
    }
}
