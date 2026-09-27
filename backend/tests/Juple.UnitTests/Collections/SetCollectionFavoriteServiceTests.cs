using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.SetCollectionFavorite;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class SetCollectionFavoriteServiceTests
{
    private const long Owner = 17;
    private const long Contributor = 18;
    private const long Stranger = 19;

    private static CollectionAccessService Access(bool isLocked = false)
    {
        var accessStore = new InMemoryCollectionAccessStore().Add(41, Owner, Contributor);
        accessStore.SetLock(41, isLocked, lockVersion: isLocked ? 1 : 0);
        return new CollectionAccessService(accessStore, new FakeUnlockTokenProtector(), TimeProvider.System);
    }

    [Theory]
    [InlineData(Owner)]
    [InlineData(Contributor)]
    public async Task SetFavoriteAsync_OwnerAndContributor_EachSetTheirOwnMark(long userId)
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider());

        await service.SetFavoriteAsync(userId, 41, new SetCollectionFavoriteCommand(true));

        Assert.Equal(userId, store.LastUserId);
        Assert.True(store.LastIsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_WithoutAccess_IsNotFound_AndNeverTouchesTheStore()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.SetFavoriteAsync(Stranger, 41, new SetCollectionFavoriteCommand(true)));
        Assert.Null(store.LastUserId);
    }

    [Fact]
    public async Task SetFavoriteAsync_OnALockedCollection_NeedsNoUnlockGrant()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionFavoriteService(Access(isLocked: true), store, new FixedTimeProvider());

        await service.SetFavoriteAsync(Contributor, 41, new SetCollectionFavoriteCommand(true));

        Assert.Equal(Contributor, store.LastUserId);
    }

    [Fact]
    public async Task SetFavoriteAsync_CallsStoreWithCurrentUserCollectionIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider(now));

        await service.SetFavoriteAsync(17, 41, new SetCollectionFavoriteCommand(true));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.True(store.LastIsFavorite);
        Assert.Equal(now, store.LastUpdatedAtUtc);
    }

    [Fact]
    public async Task SetFavoriteAsync_ReturnsStoresUpdatedCollectionDto()
    {
        var store = new FakeCollectionStore { ResultToReturn = new CollectionDto(41, "Reading list", true, 3, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "Folder", null) };
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider());

        var result = await service.SetFavoriteAsync(17, 41, new SetCollectionFavoriteCommand(true));

        Assert.Equal(41, result.Id);
        Assert.True(result.IsFavorite);
    }

    [Fact]
    public async Task SetFavoriteAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionStore { ThrowNotFound = true };
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.SetFavoriteAsync(17, 41, new SetCollectionFavoriteCommand(true)));
    }

    [Fact]
    public async Task SetFavoriteAsync_WhenConcurrentWriteConflicts_PropagatesCollectionConcurrencyException()
    {
        var store = new FakeCollectionStore { ThrowConcurrency = true };
        var service = new SetCollectionFavoriteService(Access(), store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => service.SetFavoriteAsync(17, 41, new SetCollectionFavoriteCommand(true)));
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public CollectionDto? ResultToReturn { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public bool? LastIsFavorite { get; private set; }

        public DateTimeOffset? LastUpdatedAtUtc { get; private set; }

        public Task<CollectionPage> ListAsync(
            long userId, long? itemId, long? excludeItemId, bool? isFavorite, CollectionPageCursor? cursor, int limit,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionPage([], null));

        public Task<CollectionDto> CreateAsync(
            long userId,
            string name,
            string nameNormalized,
            CollectionIcon icon,
            DateTimeOffset createdAtUtc,
            string? color = null,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(
                new CollectionDto(1, name, false, 0, createdAtUtc, createdAtUtc, icon.ToString(), color?.ToString()));

        public Task<CollectionDto> GetAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionFavoriteService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionFavoriteService tests.");

        public Task<CollectionDto> SetFavoriteAsync(
            long userId,
            long collectionId,
            bool isFavorite,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastIsFavorite = isFavorite;
            LastUpdatedAtUtc = updatedAtUtc;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            if (ThrowConcurrency)
            {
                throw new CollectionConcurrencyException(new InvalidOperationException());
            }

            return Task.FromResult(ResultToReturn ?? new CollectionDto(collectionId, "Reading list", isFavorite, 0, updatedAtUtc, updatedAtUtc, "Folder", null));
        }

        public Task<CollectionDto> SetIconAsync(
            long userId, long collectionId, CollectionIcon icon, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionFavoriteService tests.");

        public Task<CollectionDto> SetColorAsync(
            long userId, long collectionId, string color, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionFavoriteService tests.");

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
