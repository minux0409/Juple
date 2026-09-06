using Juple.Application.Collections;
using Juple.Application.Collections.GetCollectionShare;

namespace Juple.UnitTests.Collections;

public sealed class GetCollectionShareServiceTests
{
    [Fact]
    public async Task GetAsync_CallsStoreWithCurrentUserAndCollectionId()
    {
        var store = new FakeCollectionShareStore();
        var service = new GetCollectionShareService(store);

        await service.GetAsync(17, 41);

        Assert.Equal((17L, 41L), store.LastGetActiveCall);
    }

    [Fact]
    public async Task GetAsync_WhenNoActiveShare_ReturnsNull()
    {
        var store = new FakeCollectionShareStore { ResultToReturn = null };
        var service = new GetCollectionShareService(store);

        var result = await service.GetAsync(17, 41);

        Assert.Null(result);
    }

    [Fact]
    public async Task GetAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionShareStore { ThrowNotFound = true };
        var service = new GetCollectionShareService(store);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.GetAsync(17, 41));
    }

    private sealed class FakeCollectionShareStore : ICollectionShareStore
    {
        public bool ThrowNotFound { get; init; }

        public CollectionShareDto? ResultToReturn { get; init; }

        public (long UserId, long CollectionId)? LastGetActiveCall { get; private set; }

        public Task<CollectionShareDto> EnableAsync(
            long userId, long collectionId, string candidatePublicId, DateTimeOffset enabledAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetCollectionShareService tests.");

        public Task<CollectionShareDto?> GetActiveAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default)
        {
            LastGetActiveCall = (userId, collectionId);

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            return Task.FromResult(ResultToReturn);
        }

        public Task RevokeAsync(
            long userId, long collectionId, DateTimeOffset revokedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by GetCollectionShareService tests.");
    }
}
