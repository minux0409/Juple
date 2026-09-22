namespace Juple.Application.Collections;

/// <summary>Atomic multi-collection mutations. Both methods validate ownership inside one database transaction.</summary>
public interface ICollectionManagementStore
{
    Task<TransferCollectionItem.TransferCollectionItemResult> TransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default);

    Task UndoTransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, CancellationToken cancellationToken = default);

    Task MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        CancellationToken cancellationToken = default);
}
