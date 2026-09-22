namespace Juple.Application.Items.PermanentlyDeleteItem;

public interface IPermanentlyDeleteItemService
{
    Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
