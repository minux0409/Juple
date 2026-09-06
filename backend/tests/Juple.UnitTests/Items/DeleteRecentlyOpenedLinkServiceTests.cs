using Juple.Application.Items;
using Juple.Application.Items.DeleteRecentlyOpenedLink;

namespace Juple.UnitTests.Items;

public sealed class DeleteRecentlyOpenedLinkServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserAndItemId()
    {
        var store = new FakeRecentlyOpenedItemStore();
        var service = new DeleteRecentlyOpenedLinkService(store);

        await service.DeleteAsync(17, 41);

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastItemId);
    }

    private sealed class FakeRecentlyOpenedItemStore : IRecentlyOpenedItemStore
    {
        public long? LastUserId { get; private set; }

        public long? LastItemId { get; private set; }

        public Task RecordOpenAsync(
            long userId, long itemId, DateTimeOffset openedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteRecentlyOpenedLinkService tests.");

        public Task<RecentlyOpenedItemPage> GetPageAsync(
            long userId, RecentlyOpenedItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteRecentlyOpenedLinkService tests.");

        public Task DeleteAsync(long userId, long itemId, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastItemId = itemId;
            return Task.CompletedTask;
        }

        public Task DeleteAllAsync(long userId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteRecentlyOpenedLinkService tests.");
    }
}
