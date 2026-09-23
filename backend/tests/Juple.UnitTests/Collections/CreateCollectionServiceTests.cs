using Juple.Application.Collections;
using Juple.Application.Collections.CreateCollection;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

public sealed class CreateCollectionServiceTests
{
    [Fact]
    public async Task CreateAsync_TrimsNameOuterWhitespace()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("  Books to read  ", null, null));

        Assert.Equal("Books to read", store.LastCreatedName);
    }

    [Fact]
    public async Task CreateAsync_ComputesCultureInvariantUppercaseNameNormalized()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("  Books to read  ", null, null));

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
            () => service.CreateAsync(17, new CreateCollectionCommand(name, null, null)));

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
            () => service.CreateAsync(17, new CreateCollectionCommand(tooLongName, null, null)));

        Assert.Equal("name", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenNameIsExactly100Characters_Succeeds()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());
        var maxLengthName = new string('a', 100);

        await service.CreateAsync(17, new CreateCollectionCommand(maxLengthName, null, null));

        Assert.Equal(maxLengthName, store.LastCreatedName);
    }

    [Fact]
    public async Task CreateAsync_CallsStoreWithCurrentUserAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider(now));

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, null));

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(now, store.LastCreatedAtUtc);
    }

    [Fact]
    public async Task CreateAsync_WhenNameConflicts_PropagatesCollectionNameConflictException()
    {
        var store = new FakeCollectionStore { ThrowNameConflict = true };
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNameConflictException>(
            () => service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, null)));
    }

    [Fact]
    public async Task CreateAsync_WhenIconIsNotProvided_DefaultsToFolder()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, null));

        Assert.Equal(CollectionIcon.Folder, store.LastCreatedIcon);
    }

    [Fact]
    public async Task CreateAsync_WhenIconIsProvided_PassesResolvedIconToStore()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", "Plane", null));

        Assert.Equal(CollectionIcon.Plane, store.LastCreatedIcon);
    }

    [Fact]
    public async Task CreateAsync_WhenNewIconAndColorAreProvided_PreservesTheirExactValues()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books", "Book", "Lavender"));

        Assert.Equal(CollectionIcon.Book, store.LastCreatedIcon);
        Assert.Equal("Lavender", store.LastCreatedColor);
    }

    [Fact]
    public async Task CreateAsync_WhenIconIsUnrecognized_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.CreateAsync(17, new CreateCollectionCommand("Books to read", "NotARealIcon", null)));

        Assert.Equal("icon", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    [Fact]
    public async Task CreateAsync_WhenColorIsNotProvided_DefaultsToBlue()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, null));

        Assert.Equal("Blue", store.LastCreatedColor);
    }

    [Fact]
    public async Task CreateAsync_WhenColorIsProvided_PassesResolvedColorToStore()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, "Mint"));

        Assert.Equal("Mint", store.LastCreatedColor);
    }

    [Fact]
    public async Task CreateAsync_WhenCustomHexColorIsProvided_PreservesItsNormalizedWireValue()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        await service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, "#b5d8f1"));

        Assert.Equal("#B5D8F1", store.LastCreatedColor);
    }

    [Fact]
    public async Task CreateAsync_WhenColorIsUnrecognized_ThrowsInvalidCollection()
    {
        var store = new FakeCollectionStore();
        var service = new CreateCollectionService(store, new FixedTimeProvider());

        var exception = await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.CreateAsync(17, new CreateCollectionCommand("Books to read", null, "NotARealColor")));

        Assert.Equal("color", exception.Field);
        Assert.False(store.WasCreateCalled);
    }

    private sealed class FakeCollectionStore : ICollectionStore
    {
        public bool ThrowNameConflict { get; init; }

        public bool WasCreateCalled { get; private set; }

        public long? LastUserId { get; private set; }

        public string? LastCreatedName { get; private set; }

        public string? LastCreatedNameNormalized { get; private set; }

        public CollectionIcon? LastCreatedIcon { get; private set; }

        public string? LastCreatedColor { get; private set; }

        public DateTimeOffset? LastCreatedAtUtc { get; private set; }

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
            CancellationToken cancellationToken = default)
        {
            WasCreateCalled = true;
            LastUserId = userId;
            LastCreatedName = name;
            LastCreatedNameNormalized = nameNormalized;
            LastCreatedIcon = icon;
            LastCreatedColor = color;
            LastCreatedAtUtc = createdAtUtc;

            if (ThrowNameConflict)
            {
                throw new CollectionNameConflictException();
            }

            return Task.FromResult(
                new CollectionDto(1, name, false, 0, createdAtUtc, createdAtUtc, icon.ToString(), color?.ToString()));
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

        public Task<CollectionDto> SetIconAsync(
            long userId, long collectionId, CollectionIcon icon, DateTimeOffset updatedAtUtc,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by CreateCollectionService tests.");

        public Task<CollectionDto> SetColorAsync(
            long userId, long collectionId, string color, DateTimeOffset updatedAtUtc,
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
