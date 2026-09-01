namespace Juple.Application.Items.GetItemDetail;

public sealed class GetItemDetailService(IItemDetailQueryStore itemDetailQueryStore) : IGetItemDetailService
{
    public async Task<ItemDetailsDto> GetAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default) =>
        await itemDetailQueryStore.GetDetailsAsync(userId, itemId, cancellationToken)
            ?? throw new ItemNotFoundException();
}
