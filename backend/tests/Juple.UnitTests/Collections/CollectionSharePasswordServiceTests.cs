using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.SharePassword;
using Juple.Domain.Collections;

namespace Juple.UnitTests.Collections;

/// <summary>
/// A Collection's share password, separate from its Owner's lock password: the Owner manages it (and
/// is never asked for it), recipients prove it - and it is never access of its own.
/// </summary>
public sealed class CollectionSharePasswordServiceTests
{
    private const long Owner = 1;
    private const long Member = 2;
    private const long Stranger = 3;
    private const long CollectionId = 10;
    private static readonly DateTimeOffset Now = new(2026, 9, 29, 0, 0, 0, TimeSpan.Zero);

    private readonly InMemoryCollectionAccessStore _accessStore = new InMemoryCollectionAccessStore().Add(CollectionId, Owner, Member);
    private readonly InMemoryCollectionLockStore _lockStore = new InMemoryCollectionLockStore().Unlocked(CollectionId).OwnedBy(CollectionId, Owner);
    private readonly InMemorySharePasswordStore _store;
    private readonly MutableTimeProvider _time = new(Now);

    public CollectionSharePasswordServiceTests()
    {
        _store = new InMemorySharePasswordStore(_accessStore);
    }

    private CollectionAccessService Access() => new(_accessStore, new FakeUnlockTokenProtector(), _time);

    private CollectionSharePasswordService Service() => new(
        Access(),
        _store,
        new FakePasswordHasher(),
        new FakeSharePasswordProtector(),
        new CollectionPasswordVerifier(_lockStore, new FakePasswordHasher()),
        new FakeUnlockTokenProtector(),
        _time);

    private Task<CollectionSharePasswordStatusDto> SetAsync(string password, string? unlockToken = null) =>
        Service().SetAsync(Owner, CollectionId, password, password, unlockToken);

    private void LockCollection(int lockVersion = 3) => _accessStore.SetLock(CollectionId, isLocked: true, lockVersion);

    // ---------- Owner ----------

    [Fact]
    public async Task TheOwner_SetsRevealsChangesAndRemovesIt_WithoutTheStatusEverCarryingThePassword()
    {
        Assert.Equal(new CollectionSharePasswordStatusDto("none", false, null), await Service().GetStatusAsync(Owner, CollectionId));

        var status = await SetAsync("1234");
        Assert.Equal("perCollection", status.Mode);
        Assert.True(status.IsEnabled);
        Assert.Equal("1234", await Service().RevealAsync(Owner, CollectionId, null));
        Assert.Equal(1, _store.Record!.PasswordVersion);

        await SetAsync("abcd-2");
        Assert.Equal("abcd-2", await Service().RevealAsync(Owner, CollectionId, null));
        Assert.Equal(2, _store.Record!.PasswordVersion);

        var removed = await Service().RemoveAsync(Owner, CollectionId, null);
        Assert.Equal(new CollectionSharePasswordStatusDto("none", false, null), removed);
        Assert.Null(_store.Record!.PasswordHash);
        Assert.Null(_store.Record.EncryptedPassword);
        Assert.Equal(3, _store.Record.PasswordVersion);
        await Assert.ThrowsAsync<CollectionSharePasswordNotSetException>(() => Service().RevealAsync(Owner, CollectionId, null));
    }

    [Fact]
    public async Task TheStoredCopies_AreNeverThePassword()
    {
        await SetAsync("open-sesame");

        Assert.NotEqual("open-sesame", _store.Record!.PasswordHash);
        Assert.NotEqual("open-sesame", _store.Record.EncryptedPassword);
        Assert.DoesNotContain("open-sesame", _store.Record.EncryptedPassword!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task OnlyTheOwner_ManagesOrSeesIt()
    {
        await SetAsync("1234");

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().RevealAsync(Member, CollectionId, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().SetAsync(Member, CollectionId, "9999", "9999", null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().RemoveAsync(Member, CollectionId, null));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Service().GetStatusAsync(Member, CollectionId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().RevealAsync(Stranger, CollectionId, null));
    }

    [Fact]
    public async Task OnALockedCollection_TheOwnerNeedsTheirLockGrant_ToManageIt()
    {
        await SetAsync("1234");
        LockCollection(lockVersion: 3);
        var lockGrant = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Owner), 3);

        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().RevealAsync(Owner, CollectionId, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => SetAsync("5678"));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().RemoveAsync(Owner, CollectionId, null));

        Assert.Equal("1234", await Service().RevealAsync(Owner, CollectionId, lockGrant));
        await SetAsync("5678", lockGrant);
        Assert.Equal("5678", await Service().RevealAsync(Owner, CollectionId, lockGrant));
    }

    [Theory]
    [InlineData("123")]
    [InlineData(" 1234")]
    [InlineData("1234 ")]
    [InlineData("12\n34")]
    [InlineData("")]
    public async Task APasswordOutsideThePolicy_IsRejected(string password)
    {
        await Assert.ThrowsAsync<InvalidCollectionException>(() => SetAsync(password));
        Assert.Null(_store.Record);
    }

    [Fact]
    public async Task ThePolicy_Allows4To64Characters_AndComparesNfcNormalized()
    {
        await SetAsync("공유"+"비번");
        Assert.Throws<InvalidCollectionException>(() => CollectionSharePasswordPolicy.Validate(new string('a', 65)));
        Assert.Equal(new string('a', 64), CollectionSharePasswordPolicy.Validate(new string('a', 64)));
        // "é" composed (U+00E9) and decomposed (e + U+0301) are the same password.
        Assert.Equal(CollectionSharePasswordPolicy.Validate("café"), CollectionSharePasswordPolicy.Validate("café"));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => Service().SetAsync(Owner, CollectionId, "12345", "12346", null));
    }

    // ---------- Recipients ----------

    [Fact]
    public async Task ARecipient_NeedsTheSharePassword_AndOnlyThat_WhileTheOwnerNeverDoes()
    {
        await SetAsync("1234");

        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Access().RequireContentAsync(Member, CollectionId, null));
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(
            () => Access().RequireUnlockedAsync(Member, CollectionId, CollectionPermission.AddItem, null));
        await Access().RequireContentAsync(Owner, CollectionId, null);

        var grant = await Service().UnlockAsync(Member, CollectionId, "1234");
        await Access().RequireContentAsync(Member, CollectionId, grant.Token);
        await Access().RequireUnlockedAsync(Member, CollectionId, CollectionPermission.AddItem, grant.Token);
        // The role is unchanged by it: still no management.
        await Assert.ThrowsAsync<CollectionForbiddenException>(
            () => Access().RequireUnlockedAsync(Member, CollectionId, CollectionPermission.Delete, grant.Token));
    }

    [Fact]
    public async Task AWrongPassword_IsRejected_AndCounted_ThenThrottled_AndASuccessResetsIt()
    {
        await SetAsync("1234");

        for (var attempt = 0; attempt < CollectionUnlockThrottle.MaxFailures; attempt++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().UnlockAsync(Member, CollectionId, "0000"));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => Service().UnlockAsync(Member, CollectionId, "1234"));
        Assert.True(_lockStore.Throttles.ContainsKey((CollectionId, $"su:{Member}")));
        Assert.False(_lockStore.Throttles.ContainsKey((CollectionId, $"u:{Member}"))); // never the lock's counter

        _time.Now = Now.AddHours(1);
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().UnlockAsync(Member, CollectionId, "0000"));
        Assert.NotNull(await Service().UnlockAsync(Member, CollectionId, "1234"));
        Assert.False(_lockStore.Throttles.ContainsKey((CollectionId, $"su:{Member}")));
    }

    [Fact]
    public async Task AGrant_IsReused_UntilThePasswordChanges_AndIsUnnecessaryOnceRemoved()
    {
        await SetAsync("1234");
        var grant = await Service().UnlockAsync(Member, CollectionId, "1234");
        await Access().RequireContentAsync(Member, CollectionId, grant.Token);
        await Access().RequireContentAsync(Member, CollectionId, grant.Token);

        await SetAsync("5678");
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Access().RequireContentAsync(Member, CollectionId, grant.Token));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().UnlockAsync(Member, CollectionId, "1234"));
        var newGrant = await Service().UnlockAsync(Member, CollectionId, "5678");
        await Access().RequireContentAsync(Member, CollectionId, newGrant.Token);

        await Service().RemoveAsync(Owner, CollectionId, null);
        await Access().RequireContentAsync(Member, CollectionId, null);
    }

    [Fact]
    public async Task ThePassword_NeverSubstitutesForAccess()
    {
        await SetAsync("1234");

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().UnlockAsync(Stranger, CollectionId, "1234"));
        Assert.Empty(_lockStore.Throttles); // not even counted as an attempt
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Access().RequireContentAsync(
            Stranger, CollectionId, FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Stranger), 1, CollectionUnlockPurpose.SharePassword)));
        Assert.DoesNotContain(Stranger, _accessStore.Collections[CollectionId].Collaborators);
    }

    [Fact]
    public async Task WithoutASharePassword_ThereIsNothingToUnlock_AndTheOwnerIsNeverAsked()
    {
        await Assert.ThrowsAsync<CollectionSharePasswordNotSetException>(() => Service().UnlockAsync(Member, CollectionId, "1234"));
        await Access().RequireContentAsync(Member, CollectionId, null);

        await SetAsync("1234");
        await Assert.ThrowsAsync<CollectionSharePasswordNotSetException>(() => Service().UnlockAsync(Owner, CollectionId, "1234"));
    }

    // ---------- The two passwords never stand in for each other ----------

    [Fact]
    public async Task TheLock_IsTheOwnersAlone_AndTheSharePasswordNeverOpensIt()
    {
        await SetAsync("1234");
        LockCollection(lockVersion: 1);

        // Recipients are no longer asked for the Owner's lock password (and may not test it).
        var shareGrant = await Service().UnlockAsync(Member, CollectionId, "1234");
        await Access().RequireContentAsync(Member, CollectionId, shareGrant.Token);
        var lockService = new CollectionLockService(
            Access(), _lockStore.Locked(CollectionId, null), new InMemoryCollectionLockSettingsStore(_lockStore),
            new CollectionPasswordVerifier(_lockStore, new FakePasswordHasher()), new FakeUnlockTokenProtector(), _time);
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => lockService.UnlockAsync(Member, CollectionId, "anything"));

        // The Owner keeps needing the lock grant - a share-password grant is not one.
        var ownerShareToken = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Owner), 1, CollectionUnlockPurpose.SharePassword);
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Owner, CollectionId, ownerShareToken));

        // And a lock grant never opens a recipient's share-password gate.
        var memberLockToken = FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Member), 1);
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Access().RequireContentAsync(Member, CollectionId, memberLockToken));
    }

    [Fact]
    public async Task ALockedCollection_WithoutASharePassword_OpensForItsRecipients_WithoutTheOwnersPassword()
    {
        LockCollection();

        await Access().RequireContentAsync(Member, CollectionId, null);
        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Owner, CollectionId, null));
    }

    [Fact]
    public async Task ALegacyCollection_KeepsAskingItsRecipientsForTheLockPassword_UntilTheOwnerSetsASharePassword()
    {
        _accessStore.WithSharePassword(CollectionId, CollectionSharePasswordMode.LegacyCommonLock);
        _store.Record = new CollectionSharePasswordRecord(CollectionId, CollectionSharePasswordMode.LegacyCommonLock, null, null, 1, Now);
        LockCollection(lockVersion: 2);

        await Assert.ThrowsAsync<CollectionLockedException>(() => Access().RequireContentAsync(Member, CollectionId, null));
        Assert.Equal("legacyCommonLock", (await Service().GetStatusAsync(Owner, CollectionId)).Mode);
        await Assert.ThrowsAsync<CollectionSharePasswordNotSetException>(() => Service().RevealAsync(
            Owner, CollectionId, FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Owner), 2)));

        await SetAsync("1234", FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Owner), 2));
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Access().RequireContentAsync(Member, CollectionId, null));
        var grant = await Service().UnlockAsync(Member, CollectionId, "1234");
        await Access().RequireContentAsync(Member, CollectionId, grant.Token);
    }

    // ---------- Public link ----------

    [Fact]
    public void APublicLink_WithASharePassword_OpensOnlyWithAShareGrantForThatLink()
    {
        var state = new PublicShareState(70, CollectionId, "Trip", IsLocked: true, LockVersion: 5, SharePasswordMode: CollectionSharePasswordMode.PerCollection, SharePasswordVersion: 2);
        var protector = new FakeUnlockTokenProtector();
        var link = CollectionUnlockSubject.ForPublicShare(70);

        Assert.Equal(PublicShareRequirement.SharePassword, PublicShareGate.RequirementOf(state));
        Assert.False(PublicShareGate.IsUnlocked(state, null, protector, Now));
        Assert.False(PublicShareGate.IsUnlocked(state, FakeUnlockTokenProtector.Token(CollectionId, link, 5), protector, Now));
        Assert.False(PublicShareGate.IsUnlocked(state, FakeUnlockTokenProtector.Token(CollectionId, link, 1, CollectionUnlockPurpose.SharePassword), protector, Now));
        Assert.False(PublicShareGate.IsUnlocked(
            state, FakeUnlockTokenProtector.Token(CollectionId, CollectionUnlockSubject.ForUser(Member), 2, CollectionUnlockPurpose.SharePassword), protector, Now));
        Assert.True(PublicShareGate.IsUnlocked(state, FakeUnlockTokenProtector.Token(CollectionId, link, 2, CollectionUnlockPurpose.SharePassword), protector, Now));

        // A locked Collection without a share password is open to its link (the lock is the Owner's).
        Assert.Equal(PublicShareRequirement.None, PublicShareGate.RequirementOf(state with { SharePasswordMode = CollectionSharePasswordMode.None }));
        Assert.Equal(PublicShareRequirement.LockPassword, PublicShareGate.RequirementOf(state with { SharePasswordMode = CollectionSharePasswordMode.LegacyCommonLock }));
    }

    /// <summary>ICollectionSharePasswordStore in memory, mirrored into the access store like the one production table.</summary>
    private sealed class InMemorySharePasswordStore(InMemoryCollectionAccessStore accessStore) : ICollectionSharePasswordStore
    {
        public CollectionSharePasswordRecord? Record { get; set; }

        public Task<CollectionSharePasswordRecord?> GetAsync(long collectionId, CancellationToken cancellationToken = default) =>
            Task.FromResult(Record?.CollectionId == collectionId ? Record : null);

        public Task SetAsync(long collectionId, string passwordHash, string encryptedPassword, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Record = new CollectionSharePasswordRecord(
                collectionId, CollectionSharePasswordMode.PerCollection, passwordHash, encryptedPassword, (Record?.PasswordVersion ?? 0) + 1, nowUtc);
            accessStore.WithSharePassword(collectionId, Record.Mode, Record.PasswordVersion);
            return Task.CompletedTask;
        }

        public Task RemoveAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            if (Record is { Mode: not CollectionSharePasswordMode.None })
            {
                Record = Record with { Mode = CollectionSharePasswordMode.None, PasswordHash = null, EncryptedPassword = null, PasswordVersion = Record.PasswordVersion + 1, UpdatedAtUtc = nowUtc };
                accessStore.WithSharePassword(collectionId, Record.Mode, Record.PasswordVersion);
            }

            return Task.CompletedTask;
        }
    }

    /// <summary>Reversible, but never the plain password (reverses the characters under a marker).</summary>
    private sealed class FakeSharePasswordProtector : ICollectionSharePasswordProtector
    {
        public string Protect(long collectionId, string password) => $"sealed:{collectionId}:" + new string(password.Reverse().ToArray());

        public string? Unprotect(long collectionId, string protectedPassword)
        {
            var prefix = $"sealed:{collectionId}:";
            return protectedPassword.StartsWith(prefix, StringComparison.Ordinal)
                ? new string(protectedPassword[prefix.Length..].Reverse().ToArray())
                : null;
        }
    }
}
