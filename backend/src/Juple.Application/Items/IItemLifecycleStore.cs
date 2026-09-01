namespace Juple.Application.Items;

public interface IItemLifecycleStore
{
    Task MoveToWishlistAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default);

    Task MoveToArchiveAsync(
        long userId,
        long itemId,
        DateTimeOffset changedAtUtc,
        CancellationToken cancellationToken = default);
}
