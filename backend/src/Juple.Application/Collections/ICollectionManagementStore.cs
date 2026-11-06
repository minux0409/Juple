namespace Juple.Application.Collections;

/// <summary>Atomic multi-collection mutations. Every method validates ownership inside one database transaction.</summary>
public interface ICollectionManagementStore
{
    Task<TransferCollectionItem.TransferCollectionItemResult> TransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default);

    /// <summary>True when the source membership had to be re-created (it is a new relation there again).</summary>
    Task<bool> UndoTransferItemAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, CancellationToken cancellationToken = default);
}
