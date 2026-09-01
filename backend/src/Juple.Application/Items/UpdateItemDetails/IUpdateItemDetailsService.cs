namespace Juple.Application.Items.UpdateItemDetails;

public interface IUpdateItemDetailsService
{
    Task UpdateAsync(
        long userId,
        long itemId,
        UpdateItemDetailsCommand command,
        CancellationToken cancellationToken = default);
}
