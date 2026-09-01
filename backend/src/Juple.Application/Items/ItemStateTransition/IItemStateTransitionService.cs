namespace Juple.Application.Items.ItemStateTransition;

public interface IItemStateTransitionService
{
    Task MoveToWishlistAsync(long userId, long itemId, CancellationToken cancellationToken = default);

    Task MoveToArchiveAsync(long userId, long itemId, CancellationToken cancellationToken = default);
}
