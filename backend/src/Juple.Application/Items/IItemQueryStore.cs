using Juple.Domain.Items;

namespace Juple.Application.Items;

public interface IItemQueryStore
{
    /// <summary>
    /// When categoryId is set, the caller must own that Category - an other-user or missing
    /// Category throws CategoryNotFoundException rather than silently returning no Items.
    /// </summary>
    Task<ItemPage> GetByStateAsync(
        long userId,
        ItemState state,
        long? categoryId,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
