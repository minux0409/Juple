using Juple.Domain.Items;

namespace Juple.Application.Items;

public interface IItemQueryStore
{
    Task<ItemPage> GetByStateAsync(
        long userId,
        ItemState state,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
