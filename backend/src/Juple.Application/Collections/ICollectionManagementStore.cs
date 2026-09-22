namespace Juple.Application.Collections;

/// <summary>Atomic multi-collection mutations. Every method validates ownership inside one database transaction.</summary>
public interface ICollectionManagementStore
{
    Task<TransferCollectionItem.TransferCollectionItemResult> TransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default);

    Task UndoTransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, CancellationToken cancellationToken = default);

    Task<MergeCollections.MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotent - a retried call with an already-undone undoOperationId is a safe no-op (see
    /// CollectionMergeOperation.MarkUndone). Ownership is enforced by userId, not by the token's
    /// guessability - a token that does not belong to this user is treated as not found.
    /// </summary>
    Task UndoMergeAsync(long userId, Guid undoOperationId, CancellationToken cancellationToken = default);
}
