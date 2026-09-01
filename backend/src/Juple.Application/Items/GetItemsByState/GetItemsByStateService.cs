using Juple.Domain.Items;

namespace Juple.Application.Items.GetItemsByState;

public sealed class GetItemsByStateService(IItemQueryStore itemQueryStore) : IGetItemsByStateService
{
    public Task<ItemPage> GetAsync(
        long userId,
        ItemState state,
        long? categoryId,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        itemQueryStore.GetByStateAsync(userId, state, categoryId, cursor, limit, cancellationToken);
}
