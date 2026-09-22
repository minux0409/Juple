namespace Juple.Application.Collections.TransferCollectionItem;

public interface ITransferCollectionItemService
{
    Task TransferAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        CancellationToken cancellationToken = default);
}
