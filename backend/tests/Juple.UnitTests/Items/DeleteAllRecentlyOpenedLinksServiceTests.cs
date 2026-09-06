using Juple.Application.Items;
using Juple.Application.Items.DeleteAllRecentlyOpenedLinks;

namespace Juple.UnitTests.Items;

public sealed class DeleteAllRecentlyOpenedLinksServiceTests
{
    [Fact]
    public async Task DeleteAllAsync_CallsStoreWithCurrentUserOnly()
    {
        var store = new FakeRecentlyOpenedItemStore();
        var service = new DeleteAllRecentlyOpenedLinksService(store);

        await service.DeleteAllAsync(17);

        Assert.Equal(17, store.LastUserId);
    }

    private sealed class FakeRecentlyOpenedItemStore : IRecentlyOpenedItemStore
    {
        public long? LastUserId { get; private set; }

        public Task RecordOpenAsync(
            long userId, long itemId, DateTimeOffset openedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteAllRecentlyOpenedLinksService tests.");

        public Task<RecentlyOpenedItemPage> GetPageAsync(
            long userId, RecentlyOpenedItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteAllRecentlyOpenedLinksService tests.");

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteAllRecentlyOpenedLinksService tests.");

        public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            return Task.CompletedTask;
        }
    }
}
