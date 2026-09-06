using Juple.Application.Collections;
using Juple.Application.Collections.RevokeCollectionShare;

namespace Juple.UnitTests.Collections;

public sealed class RevokeCollectionShareServiceTests
{
    [Fact]
    public async Task RevokeAsync_CallsStoreWithCurrentUserCollectionIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionShareStore();
        var service = new RevokeCollectionShareService(store, new FixedTimeProvider(now));

        await service.RevokeAsync(17, 41);

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.Equal(now, store.LastRevokedAtUtc);
    }

    [Fact]
    public async Task RevokeAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionShareStore { ThrowNotFound = true };
        var service = new RevokeCollectionShareService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.RevokeAsync(17, 41));
    }

    private sealed class FakeCollectionShareStore : ICollectionShareStore
    {
        public bool ThrowNotFound { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public DateTimeOffset? LastRevokedAtUtc { get; private set; }

        public Task<CollectionShareDto> EnableAsync(
            long userId, long collectionId, string candidatePublicId, DateTimeOffset enabledAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by RevokeCollectionShareService tests.");

        public Task<CollectionShareDto?> GetActiveAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by RevokeCollectionShareService tests.");

        public Task RevokeAsync(
            long userId, long collectionId, DateTimeOffset revokedAtUtc, CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastRevokedAtUtc = revokedAtUtc;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
