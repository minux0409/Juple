using Juple.Domain.Items;

namespace Juple.Application.Items.GetItemsByState;

public interface IGetItemsByStateService
{
    Task<ItemPage> GetAsync(
        long userId,
        ItemState state,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
