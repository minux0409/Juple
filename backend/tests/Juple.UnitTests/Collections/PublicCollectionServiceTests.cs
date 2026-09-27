using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;

namespace Juple.UnitTests.Collections;

public sealed class PublicCollectionServiceTests
{
    private const long CollectionId = 5;
    private const long ShareId = 70;
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 0, 0, 0, TimeSpan.Zero);

    private static (PublicCollectionService Service, FakeStore Store, InMemoryCollectionLockStore Locks) Create(
        bool isLocked = false, int lockVersion = 1)
    {
        var store = new FakeStore
        {
            State = new PublicShareState(ShareId, CollectionId, "Books to read", isLocked, lockVersion),
        };
        var locks = new InMemoryCollectionLockStore();
        if (isLocked)
        {
            locks.Locked(CollectionId, "hash:correct-horse", lockVersion);
        }
        else
        {
            locks.Unlocked(CollectionId);
        }

        var hasher = new FakePasswordHasher();
        var service = new PublicCollectionService(
            store, locks, new CollectionPasswordVerifier(locks, hasher), new FakeUnlockTokenProtector(), new MutableTimeProvider(Now));
        return (service, store, locks);
    }

    private static string ShareToken(int lockVersion = 1) =>
        FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForPublicShare(ShareId), lockVersion);

    [Fact]
    public async Task GetCollectionAsync_UnlockedShare_ReturnsNameNotLockedAndThePermission()
    {
        var (service, _, _) = Create();

        var result = await service.GetCollectionAsync("abc123");

        Assert.Equal(new PublicCollectionDto("Books to read", false, "read"), result);
    }

    [Fact]
    public async Task GetCollectionAsync_UnknownShare_ReturnsNull()
    {
        var (service, store, _) = Create();
        store.State = null;

        Assert.Null(await service.GetCollectionAsync("unknown"));
    }

    [Fact]
    public async Task GetCollectionAsync_LockedWithoutGrant_RevealsNothingButTheLock()
    {
        var (service, _, _) = Create(isLocked: true);

        var result = await service.GetCollectionAsync("abc123", unlockToken: null);

        Assert.Equal(new PublicCollectionDto(Name: null, IsLocked: true), result);
    }

    [Fact]
    public async Task GetCollectionAsync_LockedWithValidGrant_ReturnsName()
    {
        var (service, _, _) = Create(isLocked: true);

        var result = await service.GetCollectionAsync("abc123", ShareToken());

        Assert.Equal("Books to read", result!.Name);
    }

    [Fact]
    public async Task GetItemsAsync_UnlockedShare_PassesArgumentsThroughToStore()
    {
        var cursor = new CollectionItemPageCursor(1024, 41);
        var (service, store, _) = Create();
        var expected = new PublicCollectionItemPage(
            [new PublicCollectionItemDto("Title", "https://example.test", "https://img.example/p.jpg")], null);
        store.ItemsResult = expected;

        var result = await service.GetItemsAsync("abc123", cursor, 2);

        Assert.Equal(("abc123", cursor, 2), (store.LastGetItemsPublicId, store.LastGetItemsCursor, store.LastGetItemsLimit));
        Assert.Same(expected, result);
    }

    [Fact]
    public async Task GetItemsAsync_LockedWithoutGrant_ThrowsBeforeTouchingItems()
    {
        var (service, store, _) = Create(isLocked: true);

        await Assert.ThrowsAsync<CollectionLockedException>(() => service.GetItemsAsync("abc123", null, 50));
        Assert.Null(store.LastGetItemsPublicId);
    }

    [Fact]
    public async Task GetItemsAsync_GrantForAnOlderLockVersion_IsRejected()
    {
        // Password changed (version 1 -> 2) after the grant was issued.
        var (service, store, _) = Create(isLocked: true, lockVersion: 2);

        await Assert.ThrowsAsync<CollectionLockedException>(() => service.GetItemsAsync("abc123", null, 50, ShareToken(lockVersion: 1)));
        Assert.Null(store.LastGetItemsPublicId);
    }

    [Fact]
    public async Task GetItemsAsync_UserGrantForSameCollection_DoesNotOpenThePublicShare()
    {
        var (service, _, _) = Create(isLocked: true);
        var inAppGrant = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(17), 1);

        await Assert.ThrowsAsync<CollectionLockedException>(() => service.GetItemsAsync("abc123", null, 50, inAppGrant));
    }

    [Fact]
    public async Task UnlockAsync_CorrectPassword_IssuesShareBoundGrant_ThatOpensItems()
    {
        var (service, store, _) = Create(isLocked: true);

        var grant = await service.UnlockAsync("abc123", "correct-horse");
        store.ItemsResult = new PublicCollectionItemPage([], null);

        Assert.Equal(ShareToken(), grant!.Token);
        Assert.NotNull(await service.GetItemsAsync("abc123", null, 50, grant.Token));
    }

    [Fact]
    public async Task UnlockAsync_WrongPassword_Throws_AndCountsTheFailure()
    {
        var (service, _, locks) = Create(isLocked: true);

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "nope-nope"));
        Assert.Equal(1, locks.Throttles[(CollectionId, $"p:{ShareId}")].FailedAttemptCount);
    }

    [Fact]
    public async Task UnlockAsync_AfterMaxFailures_IsThrottled_EvenWithTheRightPassword()
    {
        var (service, _, _) = Create(isLocked: true);
        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess"));
        }

        var throttled = await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => service.UnlockAsync("abc123", "correct-horse"));
        Assert.True(throttled.RetryAfterUtc > Now);
    }

    [Fact]
    public async Task UnlockAsync_UnknownShare_ReturnsNull_AndNotLocked_Throws()
    {
        var (service, store, _) = Create(isLocked: false);
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => service.UnlockAsync("abc123", "whatever"));

        store.State = null;
        Assert.Null(await service.UnlockAsync("abc123", "whatever"));
    }

    private static string Client(int n) => $"attempt-id-for-browser-{n:D4}-xxxxxxxx";

    [Fact]
    public async Task UnlockAsync_OneBrowsersFailures_DoNotLockOutAnotherBrowser()
    {
        var (service, _, _) = Create(isLocked: true);
        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess", Client(1)));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => service.UnlockAsync("abc123", "correct-horse", Client(1)));
        // A different visitor of the same link is unaffected.
        Assert.NotNull(await service.UnlockAsync("abc123", "correct-horse", Client(2)));
    }

    [Fact]
    public async Task UnlockAsync_TheLinkWideCeiling_StillBoundsAnAttackRotatingClientIds()
    {
        var (service, _, _) = Create(isLocked: true);
        for (var i = 0; i < CollectionUnlockBuckets.PublicShareCeiling; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess", Client(i)));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(
            () => service.UnlockAsync("abc123", "correct-horse", Client(9999)));
    }

    [Fact]
    public async Task UnlockAsync_Success_ClearsOnlyThatBrowsersCounter_NeverTheLinkCeiling()
    {
        var (service, _, locks) = Create(isLocked: true);
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess", Client(1)));

        Assert.NotNull(await service.UnlockAsync("abc123", "correct-horse", Client(1)));

        Assert.DoesNotContain(locks.Throttles.Keys, key => key.Item2.StartsWith($"pc:{ShareId}:", StringComparison.Ordinal));
        Assert.Equal(1, locks.Throttles[(CollectionId, $"p:{ShareId}")].FailedAttemptCount);
    }

    [Fact]
    public async Task UnlockAsync_StoresOnlyAHashOfTheBrowserAttemptId_AndPoolsMalformedOnes()
    {
        var (service, _, locks) = Create(isLocked: true);
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess", Client(7)));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => service.UnlockAsync("abc123", "wrong-guess", "bad id with spaces"));

        var clientKeys = locks.Throttles.Keys.Select(key => key.Item2).Where(key => key.StartsWith("pc:", StringComparison.Ordinal)).ToList();
        Assert.DoesNotContain(clientKeys, key => key.Contains(Client(7), StringComparison.Ordinal));
        Assert.Contains($"pc:{ShareId}:anon", clientKeys);
        Assert.All(clientKeys, key => Assert.True(key.Length <= 64));
    }

    private sealed class FakeStore : IPublicCollectionShareStore
    {
        public PublicShareState? State { get; set; }

        public PublicCollectionItemPage? ItemsResult { get; set; }

        public string? LastGetItemsPublicId { get; private set; }

        public CollectionItemPageCursor? LastGetItemsCursor { get; private set; }

        public int? LastGetItemsLimit { get; private set; }

        public Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default) =>
            Task.FromResult(State);

        public Task<PublicCollectionItemPage?> GetItemsAsync(
            string publicId, CollectionItemPageCursor? cursor, int limit, CancellationToken cancellationToken = default)
        {
            LastGetItemsPublicId = publicId;
            LastGetItemsCursor = cursor;
            LastGetItemsLimit = limit;
            return Task.FromResult(ItemsResult);
        }
    }
}
