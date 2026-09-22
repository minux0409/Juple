using Juple.Domain.Users;

namespace Juple.Application.Items.GetItemTrash;

public interface IGetItemTrashService
{
    /// <summary>plan resolves the response's own size cap server-side (see ItemTrashLimits) - never a client-supplied limit.</summary>
    Task<IReadOnlyList<ItemTrashEntryDto>> GetAsync(
        long userId, UserPlan plan, CancellationToken cancellationToken = default);
}
