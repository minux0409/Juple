namespace Juple.Application.Items.RecordItemOpen;

public sealed class RecordItemOpenService(
    IRecentlyOpenedItemStore recentlyOpenedItemStore,
    TimeProvider timeProvider) : IRecordItemOpenService
{
    public Task RecordAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
        recentlyOpenedItemStore.RecordOpenAsync(userId, itemId, timeProvider.GetUtcNow(), cancellationToken);
}
