namespace Juple.Application.Items.DeleteAllRecentlyOpenedLinks;

public sealed class DeleteAllRecentlyOpenedLinksService(IRecentlyOpenedItemStore recentlyOpenedItemStore)
    : IDeleteAllRecentlyOpenedLinksService
{
    public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default) =>
        recentlyOpenedItemStore.DeleteAllAsync(userId, cancellationToken);
}
