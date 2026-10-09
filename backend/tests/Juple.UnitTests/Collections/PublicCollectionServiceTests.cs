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
            // A locked link here is one locked before share passwords existed (legacy mode): it opens
            // with the Owner's lock password, as it always did. Share passwords: see SharePasswordPublicTests.
            State = new PublicShareState(
                ShareId, CollectionId, "Books to read", isLocked, lockVersion,
                SharePasswordMode: isLocked ? Juple.Domain.Collections.CollectionSharePasswordMode.LegacyCommonLock : Juple.Domain.Collections.CollectionSharePasswordMode.None),
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
    public async Task APrivateLink_AnswersWithItsNameOnly_AndNeverServesItsItems()
    {
        var (service, store, _) = Create();
        store.State = store.State! with { IsPublic = false, Permission = Juple.Domain.Collections.CollectionSharePermission.Write };

        var collection = await service.GetCollectionAsync("abc123");

        // The name (for "이 컬렉션에 참여하시겠습니까?") and the lock flag - no permission, and the link is marked private.
        Assert.Equal(new PublicCollectionDto("Books to read", false, null, IsPublic: false), collection);
        Assert.Null(await service.GetItemsAsync("abc123", null, 20));
        Assert.Null(store.LastGetItemsPublicId); // the item query was never even reached
    }

    [Fact]
    public async Task APrivateLinkPayload_CarriesOnlyTheNameAndTheCollectionsLook_NothingOfItsContent()
    {
        var (service, store, _) = Create();
        store.State = store.State! with { IsPublic = false, Icon = "Folder", Color = "#3366FF" };

        var json = System.Text.Json.JsonSerializer.Serialize(await service.GetCollectionAsync("abc123"), new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web));
        var keys = System.Text.Json.JsonDocument.Parse(json).RootElement.EnumerateObject().Select(property => property.Name).Order().ToList();

        Assert.Equal(["color", "icon", "iconImageUrl", "iconImageVersion", "isLocked", "isPublic", "name", "permission"], keys);
        Assert.Contains("\"isPublic\":false", json);
        Assert.Contains("\"permission\":null", json);
        foreach (var forbidden in new[] { "items", "\"url\"", "memo", "member", "preview", "title", "addedBy", "collectionId", "publicId" })
        {
            Assert.DoesNotContain(forbidden, json, StringComparison.OrdinalIgnoreCase);
        }
    }

    private sealed class FakeIconStorage(Uri? url) : Juple.Application.Collections.SetCollectionIconImage.ICollectionIconImageStorage
    {
        public (long Owner, string Blob)? LastSigned { get; private set; }

        public Task<string> UploadCollectionIconAsync(long ownerUserId, long collectionId, Juple.Application.Images.ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteCollectionIconAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<Uri?> CreateCollectionIconReadUrlAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default)
        {
            LastSigned = (ownerUserId, blobName);
            return Task.FromResult(url);
        }
    }

    private static PublicCollectionService WithIconStorage(FakeStore store, FakeIconStorage storage)
    {
        var locks = new InMemoryCollectionLockStore();
        locks.Unlocked(CollectionId);
        return new PublicCollectionService(
            store, locks, new CollectionPasswordVerifier(locks, new FakePasswordHasher()), new FakeUnlockTokenProtector(), new MutableTimeProvider(Now), null, storage);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task TheCollectionsOwnPhoto_IsSignedForItsOwner_ForPublicAndPrivateLinksAlike_WithTheSameVersionTheListUses(bool isPublic)
    {
        var store = new FakeStore { State = new PublicShareState(ShareId, CollectionId, "Books to read", false, 1, IsPublic: isPublic, Icon: "Folder", Color: "blue", OwnerUserId: 9, IconImageBlobName: "items/9/collections/5/cover-1.jpg") };
        var storage = new FakeIconStorage(new Uri("https://blob.test/cover?sig=abc"));

        var collection = await WithIconStorage(store, storage).GetCollectionAsync("abc123");

        Assert.Equal("https://blob.test/cover?sig=abc", collection!.IconImageUrl);
        Assert.Equal(Juple.Application.Collections.SetCollectionIconImage.CollectionIconImageVersion.From("items/9/collections/5/cover-1.jpg"), collection.IconImageVersion);
        Assert.Equal((9L, "items/9/collections/5/cover-1.jpg"), storage.LastSigned);
        // The blob name and the owner id never leave the server.
        var json = System.Text.Json.JsonSerializer.Serialize(collection);
        Assert.DoesNotContain("cover-1.jpg", json);
        Assert.DoesNotContain("OwnerUserId", json);
    }

    [Fact]
    public async Task ACollectionWithoutAPhoto_OrWhoseUrlCannotBeSigned_FallsBackToIconAndColor_NeverToAnItemImage()
    {
        var withoutPhoto = new FakeStore { State = new PublicShareState(ShareId, CollectionId, "Books to read", false, 1, Icon: "Folder", Color: "blue", OwnerUserId: 9) };
        var storage = new FakeIconStorage(new Uri("https://blob.test/never"));
        var plain = await WithIconStorage(withoutPhoto, storage).GetCollectionAsync("abc123");
        Assert.Null(plain!.IconImageUrl);
        Assert.Null(plain.IconImageVersion);
        Assert.Null(storage.LastSigned); // nothing was even asked of storage

        var unsignable = new FakeStore { State = withoutPhoto.State! with { IconImageBlobName = "items/9/collections/5/cover-1.jpg" } };
        var fallback = await WithIconStorage(unsignable, new FakeIconStorage(null)).GetCollectionAsync("abc123");
        Assert.Null(fallback!.IconImageUrl);
        Assert.Equal("Folder", fallback.Icon);
    }

    [Fact]
    public async Task APasswordLinkNotYetUnlocked_RevealsNoPhotoEither()
    {
        var store = new FakeStore
        {
            State = new PublicShareState(ShareId, CollectionId, "Books to read", true, 1,
                SharePasswordMode: Juple.Domain.Collections.CollectionSharePasswordMode.PerCollection, SharePasswordVersion: 1, OwnerUserId: 9, IconImageBlobName: "items/9/collections/5/cover-1.jpg"),
        };
        var storage = new FakeIconStorage(new Uri("https://blob.test/never"));

        var collection = await WithIconStorage(store, storage).GetCollectionAsync("abc123");

        Assert.Equal(new PublicCollectionDto(Name: null, IsLocked: true), collection);
        Assert.Null(storage.LastSigned);
    }

    [Fact]
    public async Task APublicLink_CarriesTheSameSafeLook_ForTheAddDialog_AndStillNoContent()
    {
        var (service, store, _) = Create();
        store.State = store.State! with { Icon = "Folder", Color = "#3366FF" };

        var collection = await service.GetCollectionAsync("abc123");

        Assert.Equal(new PublicCollectionDto("Books to read", false, "read", true, "Folder", "#3366FF"), collection);
    }

    [Fact]
    public async Task APrivateLinkWithAPassword_RevealsNothing_EvenThatItIsPrivate_UntilUnlocked()
    {
        var (service, store, _) = Create(isLocked: true);
        store.State = store.State! with { IsPublic = false };

        Assert.Equal(new PublicCollectionDto(Name: null, IsLocked: true), await service.GetCollectionAsync("abc123"));
        var unlocked = await service.GetCollectionAsync("abc123", ShareToken());
        Assert.Equal("Books to read", unlocked!.Name);
        Assert.False(unlocked.IsPublic);
    }

    [Fact]
    public async Task APrivateLinkWithAPassword_CanBeUnlocked_SoTheRequestToJoinCanFollow()
    {
        var (service, store, _) = Create(isLocked: true);
        store.State = store.State! with { IsPublic = false };

        var grant = await service.UnlockAsync("abc123", "correct-horse");

        Assert.NotNull(grant);
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

        // The PUBLIC state only: a private link never answers here (so no content path can reach it).
        public Task<PublicShareState?> GetStateAsync(string publicId, CancellationToken cancellationToken = default) =>
            Task.FromResult(State is { IsPublic: true } ? State : null);

        public Task<PublicShareState?> GetLinkStateAsync(string publicId, CancellationToken cancellationToken = default) =>
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
