namespace Juple.Application.Items.DeleteRecentlyOpenedLink;

public sealed class DeleteRecentlyOpenedLinkService(IRecentlyOpenedItemStore recentlyOpenedItemStore)
    : IDeleteRecentlyOpenedLinkService
{
    public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        recentlyOpenedItemStore.DeleteAsync(userId, itemId, cancellationToken);
}
