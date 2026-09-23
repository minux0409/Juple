using Juple.Application.Collections;
using Juple.Application.Collections.SetCollectionColor;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class SetCollectionColorServiceTests
{
    [Fact]
    public async Task SetColorAsync_CallsStoreWithCurrentUserCollectionIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new SetCollectionColorService(store, new FixedTimeProvider(now));

        await service.SetColorAsync(17, 41, new SetCollectionColorCommand("Mint"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.Equal("Mint", store.LastColor);
        Assert.Equal(now, store.LastUpdatedAtUtc);
    }

    [Fact]
    public async Task SetColorAsync_WhenColorIsMissing_DefaultsToBlue()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        await service.SetColorAsync(17, 41, new SetCollectionColorCommand(null));

        Assert.Equal("Blue", store.LastColor);
    }

    [Fact]
    public async Task SetColorAsync_WhenNewColorIsProvided_PassesItThroughUnchanged()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        await service.SetColorAsync(17, 41, new SetCollectionColorCommand("Coral"));

        Assert.Equal("Coral", store.LastColor);
    }

    [Fact]
    public async Task SetColorAsync_WhenCustomHexColorIsProvided_PreservesItsNormalizedWireValue()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        await service.SetColorAsync(17, 41, new SetCollectionColorCommand("#b5d8f1"));

        Assert.Equal("#B5D8F1", store.LastColor);
    }

    [Theory]
    [InlineData("#12345")]
    [InlineData("#GGGGGG")]
    [InlineData("B5D8F1")]
    public async Task SetColorAsync_WhenCustomHexColorIsMalformed_ThrowsInvalidCollection(string color)
    {
        var service = new SetCollectionColorService(new FakeCollectionStore(), new FixedTimeProvider());

        await Assert.ThrowsAsync<InvalidCollectionException>(() => service.SetColorAsync(17, 41, new SetCollectionColorCommand(color)));
    }

    [Fact]
    public async Task SetColorAsync_WhenColorIsUnrecognized_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.SetColorAsync(17, 41, new SetCollectionColorCommand("NotARealColor")));

        Assert.Equal("color", exception.Field);
        Assert.Null(store.LastColor);
    }

    [Fact]
    public async Task SetColorAsync_ReturnsStoresUpdatedCollectionDto()
    {
        var store = new FakeCollectionStore
        {
            ResultToReturn = new CollectionDto(41, "Reading list", false, 3, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow, "Folder", "Mint"),
        };
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        var result = await service.SetColorAsync(17, 41, new SetCollectionColorCommand("Mint"));

        Assert.Equal(41, result.Id);
        Assert.Equal("Mint", result.Color);
    }

    [Fact]
    public async Task SetColorAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionStore { ThrowNotFound = true };
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.SetColorAsync(17, 41, new SetCollectionColorCommand("Mint")));
    }

    [Fact]
    public async Task SetColorAsync_WhenConcurrentWriteConflicts_PropagatesCollectionConcurrencyException()
    {
        var store = new FakeCollectionStore { ThrowConcurrency = true };
        var service = new SetCollectionColorService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => service.SetColorAsync(17, 41, new SetCollectionColorCommand("Mint")));
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowConcurrency { get; init; }

        public CollectionDto? ResultToReturn { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public string? LastColor { get; private set; }

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
            throw new NotSupportedException("Not exercised by SetCollectionColorService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionColorService tests.");

        public Task<CollectionDto> SetFavoriteAsync(
            long userId, long collectionId, bool isFavorite, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionColorService tests.");

        public Task<CollectionDto> SetIconAsync(
            long userId, long collectionId, CollectionIcon icon, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by SetCollectionColorService tests.");

        public Task<CollectionDto> SetColorAsync(
            long userId,
            long collectionId,
            string color,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastColor = color;
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
                ResultToReturn ?? new CollectionDto(collectionId, "Reading list", false, 0, updatedAtUtc, updatedAtUtc, "Folder", color.ToString()));
        }

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
