namespace Juple.Application.Items.RestoreItem;

public interface IRestoreItemService
{
    Task RestoreAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
