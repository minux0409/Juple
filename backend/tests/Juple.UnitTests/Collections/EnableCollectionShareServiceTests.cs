using Juple.Application.Collections;
using Juple.Application.Collections.EnableCollectionShare;

namespace Juple.UnitTests.Collections;

public sealed class EnableCollectionShareServiceTests
{
    [Fact]
    public async Task EnableAsync_CallsStoreWithCurrentUserCollectionIdGeneratedPublicIdAndResolvedTimestamp()
    {
        var now = new DateTimeOffset(2026, 9, 4, 12, 0, 0, TimeSpan.Zero);
        var store = new FakeCollectionShareStore();
        var service = new EnableCollectionShareService(store, new FixedTimeProvider(now));

        await service.EnableAsync(17, 41);

        Assert.Equal(17, store.LastUserId);
        Assert.Equal(41, store.LastCollectionId);
        Assert.NotNull(store.LastCandidatePublicId);
        Assert.NotEmpty(store.LastCandidatePublicId!);
        Assert.Equal(now, store.LastEnabledAtUtc);
    }

    [Fact]
    public async Task EnableAsync_WhenCollectionNotFound_PropagatesCollectionNotFoundException()
    {
        var store = new FakeCollectionShareStore { ThrowNotFound = true };
        var service = new EnableCollectionShareService(store, new FixedTimeProvider());

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => service.EnableAsync(17, 41));
    }

    [Fact]
    public async Task EnableAsync_ReturnsStoresResult()
    {
        var expected = new CollectionShareDto(41, "expected-public-id", DateTimeOffset.UtcNow);
        var store = new FakeCollectionShareStore { ResultToReturn = expected };
        var service = new EnableCollectionShareService(store, new FixedTimeProvider());

        var result = await service.EnableAsync(17, 41);

        Assert.Same(expected, result);
    }

    [Fact]
    public async Task EnableAsync_RaiseLowerRoles_IsForwardedToTheStore_AndIsOffByDefault()
    {
        var store = new FakeCollectionShareStore();
        var service = new EnableCollectionShareService(store, new FixedTimeProvider());

        await service.EnableAsync(17, 41);
        Assert.False(store.LastRaiseLowerRoles);

        await service.EnableAsync(17, 41, Juple.Domain.Collections.CollectionSharePermission.Write, raiseLowerRoles: true);
        Assert.True(store.LastRaiseLowerRoles);
    }

    [Fact]
    public async Task SetPermissionAsync_RaiseLowerRoles_IsForwardedToTheStore_AndIsOffByDefault()
    {
        var store = new FakeCollectionShareStore();
        var service = new EnableCollectionShareService(store, new FixedTimeProvider());

        await service.SetPermissionAsync(17, 41, Juple.Domain.Collections.CollectionSharePermission.Submit);
        Assert.False(store.LastRaiseLowerRoles);
        Assert.Equal(Juple.Domain.Collections.CollectionSharePermission.Submit, store.LastPermission);

        await service.SetPermissionAsync(17, 41, Juple.Domain.Collections.CollectionSharePermission.Write, raiseLowerRoles: true);
        Assert.True(store.LastRaiseLowerRoles);
        Assert.Equal(Juple.Domain.Collections.CollectionSharePermission.Write, store.LastPermission);
    }

    [Fact]
    public async Task SetPermissionAsync_RejectsAnUnknownPermission_EvenWhenRaising()
    {
        var service = new EnableCollectionShareService(new FakeCollectionShareStore(), new FixedTimeProvider());

        await Assert.ThrowsAsync<InvalidCollectionException>(
            () => service.SetPermissionAsync(17, 41, (Juple.Domain.Collections.CollectionSharePermission)99, raiseLowerRoles: true));
    }

    private sealed class FakeCollectionShareStore : ICollectionShareStore
    {
        public bool LastRaiseLowerRoles { get; private set; }

        public Juple.Domain.Collections.CollectionSharePermission? LastPermission { get; private set; }

        public bool ThrowNotFound { get; init; }

        public CollectionShareDto? ResultToReturn { get; init; }

        public long? LastUserId { get; private set; }

        public long? LastCollectionId { get; private set; }

        public string? LastCandidatePublicId { get; private set; }

        public DateTimeOffset? LastEnabledAtUtc { get; private set; }

        public Task<CollectionShareDto> EnableAsync(
            long userId,
            long collectionId,
            string candidatePublicId,
            DateTimeOffset enabledAtUtc,
            Juple.Domain.Collections.CollectionSharePermission permission = Juple.Domain.Collections.CollectionSharePermission.Read,
            bool raiseLowerRoles = false,
            CancellationToken cancellationToken = default)
        {
            LastUserId = userId;
            LastCollectionId = collectionId;
            LastCandidatePublicId = candidatePublicId;
            LastEnabledAtUtc = enabledAtUtc;
            LastRaiseLowerRoles = raiseLowerRoles;
            LastPermission = permission;

            if (ThrowNotFound)
            {
                throw new CollectionNotFoundException();
            }

            return Task.FromResult(ResultToReturn ?? new CollectionShareDto(collectionId, candidatePublicId, enabledAtUtc));
        }

        public Task<CollectionShareDto?> GetActiveAsync(
            long userId, long collectionId, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by EnableCollectionShareService tests.");

        public Task RevokeAsync(
            long userId, long collectionId, DateTimeOffset revokedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("Not exercised by EnableCollectionShareService tests.");

        public Task<CollectionShareDto?> SetPermissionAsync(
            long userId, long collectionId, Juple.Domain.Collections.CollectionSharePermission permission, DateTimeOffset updatedAtUtc, bool raiseLowerRoles = false,
            CancellationToken cancellationToken = default)
        {
            LastRaiseLowerRoles = raiseLowerRoles;
            LastPermission = permission;
            return Task.FromResult<CollectionShareDto?>(new CollectionShareDto(collectionId, "public-id", updatedAtUtc, permission));
        }
    }

    private sealed class FixedTimeProvider(DateTimeOffset? utcNow = null) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() =>
            utcNow ?? new DateTimeOffset(2026, 9, 4, 0, 0, 0, TimeSpan.Zero);
    }
}
