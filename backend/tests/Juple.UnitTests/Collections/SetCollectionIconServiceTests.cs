using Juple.Application.Collections;
using Juple.Application.Collections.SetCollectionIcon;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class SetCollectionIconServiceTests
{
    [Fact]
    public async Task SetIconAsync_CallsStoreWithCurrentUserCollectionIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new SetCollectionIconService(store, new FixedTimeProvider(now));

        await service.SetIconAsync(17, 41, new SetCollectionIconCommand("Plane"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.Equal(CollectionIcon.Plane, store.LastIcon);
        Assert.Equal(now, store.LastUpdatedAtUtc);
    }

    [Fact]
    public async Task SetIconAsync_WhenIconIsMissing_DefaultsToFolder()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        await service.SetIconAsync(17, 41, new SetCollectionIconCommand(null));

        Assert.Equal(CollectionIcon.Folder, store.LastIcon);
    }

    [Fact]
    public async Task SetIconAsync_WhenNewIconIsProvided_PassesItThroughUnchanged()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        await service.SetIconAsync(17, 41, new SetCollectionIconCommand("Camera"));

        Assert.Equal(CollectionIcon.Camera, store.LastIcon);
    }

    [Fact]
    public async Task SetIconAsync_WhenIconIsUnrecognized_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.SetIconAsync(17, 41, new SetCollectionIconCommand("NotARealIcon")));

        Assert.Equal("icon", exception.Field);
        Assert.Null(store.LastIcon);
    }

    [Fact]
    public async Task SetIconAsync_ReturnsStoresUpdatedCollectionDto()
    {
        var store = new FakeCollectionStore
        {
            ResultToReturn = new CollectionDto(41, "Reading list", false, 3, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "Plane", null),
        };
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        var result = await service.SetIconAsync(17, 41, new SetCollectionIconCommand("Plane"));

        Assert.Equal(41, result.Id);
        Assert.Equal("Plane", result.Icon);
    }

    [Fact]
    public async Task SetIconAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionStore { ThrowNotFound = true };
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.SetIconAsync(17, 41, new SetCollectionIconCommand("Plane")));
    }

    [Fact]
    public async Task SetIconAsync_WhenConcurrentWriteConflicts_PropagatesCollectionConcurrencyException()
    {
        var store = new FakeCollectionStore { ThrowConcurrency = true };
        var service = new SetCollectionIconService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => service.SetIconAsync(17, 41, new SetCollectionIconCommand("Plane")));
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public CollectionDto? ResultToReturn { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public CollectionIcon? LastIcon { get; private set; }

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
            throw new NotSupportedException("Not exercised by SetCollectionIconService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionIconService tests.");

        public Task<CollectionDto> SetFavoriteAsync(
            long userId, long collectionId, bool isFavorite, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionIconService tests.");

        public Task<CollectionDto> SetIconAsync(
            long userId,
            long collectionId,
            CollectionIcon icon,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastIcon = icon;
            LastUpdatedAtUtc = updatedAtUtc;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            if (ThrowConcurrency)
            {
                throw new CollectionConcurrencyException(new InvalidOperationException());
            }

            return Task.FromResult(
                ResultToReturn ?? new CollectionDto(collectionId, "Reading list", false, 0, updatedAtUtc, updatedAtUtc, icon.ToString(), null));
        }

        public Task<CollectionDto> SetColorAsync(
            long userId, long collectionId, string color, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionIconService tests.");

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
