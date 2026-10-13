namespace Juple.Application.Collections.HomeSummary;

public sealed class HomeCollectionsSummaryService(ICollectionStore collectionStore) : IHomeCollectionsSummaryService
{
    public Task<HomeCollectionsSummary> GetAsync(long userId, CancellationToken cancellationToken = default) =>
        collectionStore.GetHomeSummaryAsync(userId, IHomeCollectionsSummaryService.FavoriteShortcutLimit, cancellationToken);
}
