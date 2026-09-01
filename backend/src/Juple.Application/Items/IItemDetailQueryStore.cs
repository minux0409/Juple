namespace Juple.Application.Items;

public interface IItemDetailQueryStore
{
    /// <summary>Returns null when no Item with this Id is owned by this UserId.</summary>
    Task<ItemDetailsDto?> GetDetailsAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default);
}
