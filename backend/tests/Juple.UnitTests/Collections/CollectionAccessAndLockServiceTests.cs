using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;

namespace Juple.UnitTests.Collections;

public sealed class CollectionAccessAndLockServiceTests
{
    private const long Owner = 1;
    private const long Contributor = 2;
    private const long Stranger = 3;
    private const long CollectionId = 10;
    private const long LegacyA = 11;
    private const long LegacyB = 12;
    private static readonly DateTimeOffset Now = new(2026, 9, 26, 0, 0, 0, TimeSpan.Zero);

    // These cover the lock as it always was - also for recipients - so the Collections are in the
    // legacy share mode (locked before share passwords existed); the new rules are in
    // CollectionSharePasswordServiceTests.
    private readonly InMemoryCollectionAccessStore _accessStore = new InMemoryCollectionAccessStore()
        .Add(CollectionId, Owner, Contributor)
        .WithSharePassword(CollectionId, Juple.Domain.Collections.CollectionSharePasswordMode.LegacyCommonLock);
    private readonly InMemoryCollectionLockStore _lockStore = new InMemoryCollectionLockStore().Unlocked(CollectionId).OwnedBy(CollectionId, Owner);
    private readonly MutableTimeProvider _time = new(Now);
    private readonly InMemoryCollectionLockSettingsStore _settings;

    public CollectionAccessAndLockServiceTests()
    {
        _settings = new InMemoryCollectionLockSettingsStore(_lockStore);
    }

    private CollectionAccessService Access() => new(_accessStore, new FakeUnlockTokenProtector(), _time);

    private CollectionLockService LockService()
    {
        var hasher = new FakePasswordHasher();
        return new CollectionLockService(
            Access(), _lockStore, _settings, new CollectionPasswordVerifier(_lockStore, hasher), new FakeUnlockTokenProtector(), _time);
    }

    private CollectionLockPasswordService PasswordService() => new(_settings, new FakePasswordHasher(), _time);

    /// <summary>Settings > 컬렉션 잠금, right after a real sign-in.</summary>
    private Task SetOwnerPasswordAsync(string password) => PasswordService().ResetAsync(Owner, password, password, _time.Now);

    /// <summary>Keeps the two in-memory stores' view of the lock in sync (production reads one table).</summary>
    private void SyncLockIntoAccessStore(long collectionId = CollectionId)
    {
        var state = _lockStore.States[collectionId];
        _accessStore.SetLock(collectionId, state.IsLocked, state.LockVersion);
    }

    /// <summary>Another Collection of the same Owner, locked with its own legacy per-Collection password.</summary>
    private void AddLegacyLocked(long collectionId, string password)
    {
        _accessStore.Add(collectionId, Owner, Contributor).WithSharePassword(collectionId, Juple.Domain.Collections.CollectionSharePasswordMode.LegacyCommonLock);
        _lockStore.Locked(collectionId, "hash:" + password).OwnedBy(collectionId, Owner);
        SyncLockIntoAccessStore(collectionId);
    }

    private async Task LockWithOwnerPasswordAsync(string password)
    {
        await SetOwnerPasswordAsync(password);
        await LockService().LockAsync(Owner, CollectionId);
        SyncLockIntoAccessStore();
    }

    // ---------- policy table ----------

    [Fact]
    public void Owner_HasEveryPermission()
    {
        var access = new CollectionAccess(CollectionId, CollectionAccessRole.Owner, false, 0);
        Assert.All(Enum.GetValues<CollectionPermission>(), permission => Assert.True(access.Allows(permission)));
    }

    [Fact]
    public void Contributor_MayOnlyViewAddItems_AndKeepTheirOwnFavoriteMark()
    {
        var access = new CollectionAccess(CollectionId, CollectionAccessRole.Contributor, false, 0);
        var allowed = Enum.GetValues<CollectionPermission>().Where(access.Allows).ToHashSet();

        Assert.Equal(
            new HashSet<CollectionPermission> { CollectionPermission.View, CollectionPermission.AddItem, CollectionPermission.Favorite },
            allowed);
    }

    [Fact]
    public void Viewer_MayOnlyView_AndKeepTheirOwnFavoriteMark()
    {
        var access = new CollectionAccess(CollectionId, CollectionAccessRole.Viewer, false, 0);
        var allowed = Enum.GetValues<CollectionPermission>().Where(access.Allows).ToHashSet();

        Assert.Equal(new HashSet<CollectionPermission> { CollectionPermission.View, CollectionPermission.Favorite }, allowed);
        Assert.False(access.IsOwner);
    }

    [Fact]
    public async Task NoAccess_IsIndistinguishableFromANonExistentCollection()
    {
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Access().RequireAsync(Stranger, CollectionId, CollectionPermission.View));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Access().RequireAsync(Owner, 999, CollectionPermission.View));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Access().RequireAsync(Contributor, CollectionId, CollectionPermission.Delete));
    }

    // ---------- lock management (the Owner's one lock password) ----------

    [Fact]
    public async Task OnlyTheOwner_ManagesTheLock()
    {
        await SetOwnerPasswordAsync("secret-1");
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => LockService().LockAsync(Contributor, CollectionId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => LockService().LockAsync(Stranger, CollectionId));

        await LockService().LockAsync(Owner, CollectionId);
        Assert.True(_lockStore.States[CollectionId].IsLocked);
    }

    [Fact]
    public async Task Locking_NeedsTheOwnersLockPasswordFirst_AndCreatesNoPasswordOfItsOwn()
    {
        await Assert.ThrowsAsync<CollectionLockPasswordNotConfiguredException>(() => LockService().LockAsync(Owner, CollectionId));
        Assert.False(_lockStore.States[CollectionId].IsLocked);

        await SetOwnerPasswordAsync("secret-1");
        await LockService().LockAsync(Owner, CollectionId);
        var state = _lockStore.States[CollectionId];
        Assert.True(state.IsLocked);
        Assert.Equal(1, state.LockVersion);
        Assert.Null(state.PasswordHash);

        // Already locked: nothing changes, outstanding grants stay valid.
        await LockService().LockAsync(Owner, CollectionId);
        Assert.Equal(1, _lockStore.States[CollectionId].LockVersion);
    }

    [Fact]
    public async Task RemovingTheLock_NeedsTheOwnersLockPassword_NoBypassForTheOwner()
    {
        await LockWithOwnerPasswordAsync("secret-1");

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().RemoveAsync(Owner, CollectionId, null));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().RemoveAsync(Owner, CollectionId, "wrong-pass"));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => LockService().RemoveAsync(Contributor, CollectionId, "secret-1"));
        await LockService().RemoveAsync(Owner, CollectionId, "secret-1");

        Assert.False(_lockStore.States[CollectionId].IsLocked);
        Assert.Equal(2, _lockStore.States[CollectionId].LockVersion);
    }

    // ---------- transition from per-Collection passwords ----------

    [Fact]
    public async Task WithoutALockPassword_LegacyPerCollectionPasswordsKeepWorking()
    {
        AddLegacyLocked(LegacyA, "aaa-legacy");
        AddLegacyLocked(LegacyB, "bbb-legacy");

        Assert.NotNull(await LockService().UnlockAsync(Owner, LegacyA, "aaa-legacy"));
        Assert.NotNull(await LockService().UnlockAsync(Contributor, LegacyB, "bbb-legacy"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Owner, LegacyA, "bbb-legacy"));
        Assert.False((await _lockStore.GetStateAsync(LegacyA))!.UsesOwnerPassword);
    }

    [Fact]
    public async Task SettingTheLockPassword_TakesOverEveryLockedCollection_AndRevokesEveryGrant()
    {
        AddLegacyLocked(LegacyA, "aaa-legacy");
        AddLegacyLocked(LegacyB, "bbb-legacy");
        var grantA = await LockService().UnlockAsync(Contributor, LegacyA, "aaa-legacy");

        await SetOwnerPasswordAsync("common-1");
        SyncLockIntoAccessStore(LegacyA);
        SyncLockIntoAccessStore(LegacyB);

        foreach (var collectionId in new[] { LegacyA, LegacyB })
        {
            Assert.Equal(2, _lockStore.States[collectionId].LockVersion);
            Assert.NotNull(await LockService().UnlockAsync(Owner, collectionId, "common-1"));
        }

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Owner, LegacyA, "aaa-legacy"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Owner, LegacyB, "bbb-legacy"));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Contributor, LegacyA, grantA.Token));
        // The legacy hashes stay stored - only ignored.
        Assert.Equal("hash:aaa-legacy", _lockStore.States[LegacyA].PasswordHash);
    }

    [Fact]
    public async Task ChangingTheLockPassword_MovesEveryLockedCollection_AndTheOldOneStopsWorking()
    {
        AddLegacyLocked(LegacyA, "aaa-legacy");
        await LockWithOwnerPasswordAsync("common-1");
        var grant = await LockService().UnlockAsync(Contributor, CollectionId, "common-1");

        await PasswordService().ChangeAsync(Owner, "common-1", "common-2", "common-2");
        SyncLockIntoAccessStore();

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Owner, CollectionId, "common-1"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Owner, LegacyA, "common-1"));
        Assert.NotNull(await LockService().UnlockAsync(Owner, CollectionId, "common-2"));
        Assert.NotNull(await LockService().UnlockAsync(Owner, LegacyA, "common-2"));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Contributor, CollectionId, grant.Token));
    }

    [Fact]
    public async Task OneOwnersPassword_NeverOpensAnotherOwnersCollection()
    {
        const long otherOwner = 4;
        const long otherCollection = 20;
        _accessStore.Add(otherCollection, otherOwner, Contributor).WithSharePassword(otherCollection, Juple.Domain.Collections.CollectionSharePasswordMode.LegacyCommonLock);
        _lockStore.Locked(otherCollection, null).OwnedBy(otherCollection, otherOwner).WithOwnerPassword(otherOwner, "hash:theirs-1");
        await LockWithOwnerPasswordAsync("common-1");

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Contributor, otherCollection, "common-1"));
        Assert.NotNull(await LockService().UnlockAsync(Contributor, otherCollection, "theirs-1"));
        Assert.Equal(1, _lockStore.States[otherCollection].LockVersion);
    }

    [Fact]
    public async Task LockedContent_NeedsAGrant_ForOwnerAndContributorAlike()
    {
        await LockWithOwnerPasswordAsync("secret-1");

        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Owner, CollectionId, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Contributor, CollectionId, null));

        var grant = await LockService().UnlockAsync(Contributor, CollectionId, "secret-1");
        await Access().RequireContentAsync(Contributor, CollectionId, grant.Token);
        // Bound to the user it was issued to.
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Owner, CollectionId, grant.Token));
    }

    [Fact]
    public async Task ThePassword_NeverSubstitutesForAccess()
    {
        await LockWithOwnerPasswordAsync("secret-1");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => LockService().UnlockAsync(Stranger, CollectionId, "secret-1"));
        Assert.Empty(_lockStore.Throttles); // not even counted as an attempt
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => LockService().RemoveAsync(Contributor, CollectionId, "secret-1"));
    }

    [Fact]
    public async Task Unlock_IsThrottledPerSubject_AndRefusedBeforeAnyPasswordCheck()
    {
        await LockWithOwnerPasswordAsync("secret-1");
        for (var i = 0; i < 5; i++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => LockService().UnlockAsync(Contributor, CollectionId, "guess-" + i));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => LockService().UnlockAsync(Contributor, CollectionId, "secret-1"));
        Assert.NotNull(await LockService().UnlockAsync(Owner, CollectionId, "secret-1"));

        _time.Now = Now + TimeSpan.FromMinutes(16);
        Assert.NotNull(await LockService().UnlockAsync(Contributor, CollectionId, "secret-1"));
    }

    [Fact]
    public async Task Unlocking_ANotLockedCollection_IsAConflict()
    {
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => LockService().UnlockAsync(Owner, CollectionId, "anything"));
    }

    // ---------- the source rule itself ----------

    [Fact]
    public void PasswordSource_TheOwnersLockPasswordWhenItExists_ElseTheLegacyOne()
    {
        Assert.Equal(("owner", true), CollectionLockPasswordSource.Resolve("own", "owner"));
        Assert.Equal(("owner", true), CollectionLockPasswordSource.Resolve(null, "owner"));
        Assert.Equal(("own", false), CollectionLockPasswordSource.Resolve("own", null));
        Assert.Equal(((string?)null, false), CollectionLockPasswordSource.Resolve(null, null));
    }
}
