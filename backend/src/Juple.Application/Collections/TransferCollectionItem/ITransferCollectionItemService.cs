namespace Juple.Application.Collections.TransferCollectionItem;

public interface ITransferCollectionItemService
{
    /// <remarks>unlockToken may carry grants for both Collections, comma-separated.</remarks>
    Task<TransferCollectionItemResult> TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default);
}
