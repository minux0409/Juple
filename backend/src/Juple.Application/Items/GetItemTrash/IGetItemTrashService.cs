namespace Juple.Application.Items.GetItemTrash;

public interface IGetItemTrashService
{
    /// <summary>The response's size cap is resolved server-side (ItemTrashLimits.ListLimit) - never a client-supplied limit.</summary>
    Task<IReadOnlyList<ItemTrashEntryDto>> GetAsync(
        long userId, CancellationToken cancellationToken = default);
}
