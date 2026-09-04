using Juple.Application.Collections;
using Juple.Application.Collections.RenameCollection;

namespace Juple.UnitTests.Collections;

public sealed class RenameCollectionServiceTests
{
    [Fact]
    public async Task RenameAsync_TrimsNameOuterWhitespace()
    {
        var store = new FakeCollectionStore();
        var service = new RenameCollectionService(store, new FixedTimeProvider());

        await service.RenameAsync(17, 41, new RenameCollectionCommand("  Reading list  "));

        Assert.Equal("Reading list", store.LastName);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task RenameAsync_WhenNameIsMissingOrWhitespaceOnly_ThrowsInvalidCollection(string? name)
    {
        var store = new FakeCollectionStore();
        var service = new RenameCollectionService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.RenameAsync(17, 41, new RenameCollectionCommand(name)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasRenameCalled);
    }

    [Fact]
    public async Task RenameAsync_WhenNameExceeds100Characters_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new RenameCollectionService(store, new FixedTimeProvider());
        var tooLongName = new string('a', 101);

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.RenameAsync(17, 41, new RenameCollectionCommand(tooLongName)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasRenameCalled);
    }

    [Fact]
    public async Task RenameAsync_CallsStoreWithCurrentUserCollectionIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new RenameCollectionService(store, new FixedTimeProvider(now));

        await service.RenameAsync(17, 41, new RenameCollectionCommand("Reading list"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.Equal(now, store.LastUpdatedAtUtc);
    }

    [Fact]
    public async Task RenameAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionStore { ThrowNotFound = true };
        var service = new RenameCollectionService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(
            () => service.RenameAsync(17, 41, new RenameCollectionCommand("Reading list")));
    }

    [Fact]
    public async Task RenameAsync_WhenNameConflicts_PropagatesCollectionNameConflictException()
    {
        var store = new FakeCollectionStore { ThrowNameConflict = true };
        var service = new RenameCollectionService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => service.RenameAsync(17, 41, new RenameCollectionCommand("Reading list")));
    }

    [Fact]
    public async Task RenameAsync_WhenConcurrentWriteConflicts_PropagatesCollectionConcurrencyException()
    {
        var store = new FakeCollectionStore { ThrowConcurrency = true };
        var service = new RenameCollectionService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionConcurrencyException>(
            () => service.RenameAsync(17, 41, new RenameCollectionCommand("Reading list")));
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNotFound { get; init; }

        public bool ThrowNameConflict { get; init; }

        public bool ThrowConcurrency { get; init; }

        public bool WasRenameCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public string? LastName { get; private set; }

        public DateTimeOffset? LastUpdatedAtUtc { get; private set; }

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
            throw new NotSupportedException("Not exercised by RenameCollectionService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasRenameCalled = true;
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastName = name;
            LastUpdatedAtUtc = updatedAtUtc;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            if (ThrowNameConflict)
            {
                throw new CollectionNameConflictException();
            }

            if (ThrowConcurrency)
            {
                throw new CollectionConcurrencyException(new InvalidOperationException());
            }

            return Task.CompletedTask;
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
