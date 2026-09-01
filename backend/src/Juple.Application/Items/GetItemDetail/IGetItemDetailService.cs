namespace Juple.Application.Items.GetItemDetail;

public interface IGetItemDetailService
{
    Task<ItemDetailsDto> GetAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
