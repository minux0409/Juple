namespace Juple.Application.Collections.UndoTransferCollectionItem;

public interface IUndoTransferCollectionItemService
{
    Task UndoAsync(long userId, long sourceCollectionId, long itemId, long targetCollectionId,
        bool targetMembershipCreated, string? unlockToken = null, CancellationToken cancellationToken = default);
}
