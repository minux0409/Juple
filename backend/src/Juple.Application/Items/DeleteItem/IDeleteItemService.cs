namespace Juple.Application.Items.DeleteItem;

public interface IDeleteItemService
{
    Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
