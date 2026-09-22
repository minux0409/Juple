namespace Juple.Application.Collections.TransferCollectionItem;

public interface ITransferCollectionItemService
{
    Task<TransferCollectionItemResult> TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default);
}
