using Juple.Application.Collections;
using Juple.Application.Collections.CreateCollection;

namespace Juple.UnitTests.Collections;

public sealed class CreateCollectionServiceTests
{
    [Fact]
    public async Task CreateAsync_TrimsNameOuterWhitespace()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("  Books to read  "));

        Assert.Equal("Books to read", store.LastCreatedName);
    }

    [Fact]
    public async Task CreateAsync_ComputesCultureInvariantUppercaseNameNormalized()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("  Books to read  "));

        Assert.Equal("BOOKS TO READ", store.LastCreatedNameNormalized);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task CreateAsync_WhenNameIsMissingOrWhitespaceOnly_ThrowsInvalidCollection(string? name)
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.CreateAsync(17, new CreateCollectionCommand(name)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenNameExceeds100Characters_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());
        var tooLongName = new string('a', 101);

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.CreateAsync(17, new CreateCollectionCommand(tooLongName)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenNameIsExactly100Characters_Succeeds()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());
        var maxLengthName = new string('a', 100);

        await service.CreateAsync(17, new CreateCollectionCommand(maxLengthName));

        Assert.Equal(maxLengthName, store.LastCreatedName);
    }

    [Fact]
    public async Task CreateAsync_CallsStoreWithCurrentUserAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider(now));

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read"));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(now, store.LastCreatedAtUtc);
    }

    [Fact]
    public async Task CreateAsync_WhenNameConflicts_PropagatesCollectionNameConflictException()
    {
        var store = new FakeCollectionStore { ThrowNameConflict = true };
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => service.CreateAsync(17, new CreateCollectionCommand("Books to read")));
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNameConflict { get; init; }

        public bool WasCreateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public string? LastCreatedName { get; private set; }

        public string? LastCreatedNameNormalized { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

        public Task<CollectionPage> ListAsync(
            long userId, long? itemId, long? excludeItemId, bool? isFavorite, CollectionPageCursor? cursor, int limit,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(new CollectionPage([], null));

        public Task<CollectionDto> CreateAsync(
            long userId,
            string name,
            string nameNormalized,
            DateTimeOffset createdAtUtc,
            CancellationToken cancellationToken = default)
        {
            WasCreateCalled = true;
            LastUserId = userId;
            LastCreatedName = name;
            LastCreatedNameNormalized = nameNormalized;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowNameConflict)
            {
                throw new CollectionNameConflictException();
            }

            return Task.FromResult(new CollectionDto(1, name, false, 0, createdAtUtc, createdAtUtc));
        }

        public Task<CollectionDto> GetAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by CreateCollectionService tests.");

        public Task RenameAsync(
            long userId,
            long collectionId,
            string name,
            string nameNormalized,
            DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<CollectionDto> SetFavoriteAsync(
            long userId, long collectionId, bool isFavorite, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by CreateCollectionService tests.");

        public Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
