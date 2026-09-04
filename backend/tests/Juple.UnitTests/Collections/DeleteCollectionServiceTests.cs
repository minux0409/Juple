using Juple.Application.Collections;
using Juple.Application.Collections.DeleteCollection;

namespace Juple.UnitTests.Collections;

public sealed class DeleteCollectionServiceTests
{
    [Fact]
    public async Task DeleteAsync_CallsStoreWithCurrentUserAndCollectionId()
    {
        var store = new FakeCollectionStore();
        var service = new DeleteCollectionService(store);

        await service.DeleteAsync(17, 41);

        Assert.Equal((17L, 41L), store.LastDeleteCall);
    }

    [Fact]
    public async Task DeleteAsync_CalledTwice_SucceedsBothTimesAsIdempotentRetry()
    {
        var store = new FakeCollectionStore();
        var service = new DeleteCollectionService(store);

        await service.DeleteAsync(17, 41);
        await service.DeleteAsync(17, 41);

        Assert.Equal(2, store.DeleteCallCount);
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public int DeleteCallCount { get; private set; }

        public (long UserId, long CollectionId)? LastDeleteCall { get; private set; }

        public Task<CollectionPage> ListAsync(
            long userId, long? itemId, long? excludeItemId, CollectionPageCursor? cursor, int limit,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionPage([], null));

        public Task<CollectionDto> CreateAsync(
            long userId,
            string name,
            string nameNormalized,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionDto(1, name, 0, createdAtUtc, createdAtUtc));

        public Task<CollectionDto> GetAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by DeleteCollectionService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default)
        {
            DeleteCallCount++;
            LastDeleteCall = (userId, collectionId);
            return Task.CompletedTask;
        }
    }
}
