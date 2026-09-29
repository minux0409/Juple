using System.Security.Cryptography;
using System.Text.Json;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.SharePassword;
using Juple.Application.Images;
using Juple.Domain.Collections;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// A Collection's own share password against the real schema, with the real hasher, the real
/// AES-GCM sealing and the real grant tokens: the Owner manages (and is never asked for) it,
/// members and public-link visitors prove it, it is never access of its own, and it is independent
/// of the Owner's Collection lock password.
/// </summary>
public sealed class CollectionSharePasswordIntegrationTests : IAsyncLifetime
{
    private const string SharePassword = "trip-2026";

    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private readonly string _grantKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private readonly string _sealKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
    private readonly CollectionLockPasswordHasher _hasher = new();

    private long _owner;
    private long _viewer;
    private long _contributor;
    private long _stranger;
    private long _sharedId;
    private long _privateId;
    private long _ownerItem;
    private long _contributorItem;

    private CollectionStore _collections = null!;
    private CollectionShareStore _shares = null!;
    private CollectionCollaborationService _collaboration = null!;
    private AddItemToCollectionService _addItem = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = NewContext(connectionString);

        _owner = await NewUserAsync();
        _viewer = await NewUserAsync();
        _contributor = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _shares = new CollectionShareStore(_db);
        _collaboration = new CollectionCollaborationService(Access(), new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _addItem = new AddItemToCollectionService(Access(), _collections, TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _privateId = (await _collections.CreateAsync(_owner, "Private", "PRIVATE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _ownerItem = (await new ItemStore(_db).SaveAsync(_owner, "https://example.test/owner", null, DateTimeOffset.UtcNow)).Entry.Id;
        _contributorItem = (await new ItemStore(_db).SaveAsync(_contributor, "https://example.test/contributor", null, DateTimeOffset.UtcNow)).Entry.Id;
        await _addItem.AddAsync(_owner, _sharedId, _ownerItem);
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    private static JupleDbContext NewContext(string connectionString) =>
        new(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

    private CollectionUnlockTokenProtector Tokens() => new(Options.Create(new CollectionUnlockGrantOptions { EncryptionKey = _grantKey }));

    private CollectionSharePasswordProtector Sealer() => new(Options.Create(new CollectionSharePasswordOptions { EncryptionKey = _sealKey }));

    private CollectionAccessService Access(JupleDbContext? db = null) => new(new CollectionAccessStore(db ?? _db), Tokens(), TimeProvider.System);

    private CollectionSharePasswordService Service(JupleDbContext? db = null)
    {
        var context = db ?? _db;
        var lockStore = new CollectionLockStore(context);
        return new CollectionSharePasswordService(
            Access(context), new CollectionSharePasswordStore(context), _hasher, Sealer(),
            new CollectionPasswordVerifier(lockStore, _hasher), Tokens(), TimeProvider.System);
    }

    private GetCollectionItemsService Items() => new(Access(), _collections, new NoImages());

    private GetCollectionItemSectionsService Sections() => new(Access(), _collections, TimeProvider.System);

    private PublicCollectionService Public()
    {
        var lockStore = new CollectionLockStore(_db);
        return new PublicCollectionService(
            new PublicCollectionStore(_db), lockStore, new CollectionPasswordVerifier(lockStore, _hasher), Tokens(), TimeProvider.System,
            new CollectionSharePasswordStore(_db));
    }

    private Task<CollectionSharePasswordStatusDto> SetSharePasswordAsync(string password = SharePassword, string? unlockToken = null) =>
        Service().SetAsync(_owner, _sharedId, password, password, unlockToken);

    // ---------- Owner ----------

    [Fact]
    public async Task TheOwner_SetsAndRevealsIt_AndNeitherStoredCopyIsThePassword()
    {
        var status = await SetSharePasswordAsync();
        _db.ChangeTracker.Clear();

        Assert.Equal("perCollection", status.Mode);
        var row = await _db.CollectionSharePasswords.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId);
        Assert.NotEqual(SharePassword, row.PasswordHash);
        Assert.DoesNotContain(SharePassword, row.PasswordHash!, StringComparison.Ordinal);
        Assert.DoesNotContain(SharePassword, row.EncryptedPassword!, StringComparison.Ordinal);
        Assert.True(_hasher.Verify(row.PasswordHash!, SharePassword));
        Assert.Equal(SharePassword, await Service().RevealAsync(_owner, _sharedId, null));

        // The status and every ordinary Collection response carry nothing of it.
        Assert.DoesNotContain(SharePassword, JsonSerializer.Serialize(status), StringComparison.Ordinal);
        var asOwner = await _collections.GetAsync(_owner, _sharedId);
        var asMember = await _collections.GetAsync(_viewer, _sharedId);
        Assert.True(asOwner.IsSharePasswordProtected);
        Assert.True(asMember.IsSharePasswordProtected);
        Assert.DoesNotContain(SharePassword, JsonSerializer.Serialize(asMember), StringComparison.Ordinal);
    }

    [Fact]
    public async Task TheOwner_IsNeverAskedForIt_ButTheirLockStillApplies_AndGuardsManagingIt()
    {
        await SetSharePasswordAsync();
        await Items().GetAsync(_owner, _sharedId, null, 25);

        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await Assert.ThrowsAsync<CollectionLockedException>(() => Items().GetAsync(_owner, _sharedId, null, 25));
        await Assert.ThrowsAsync<CollectionLockedException>(() => Service().RevealAsync(_owner, _sharedId, null));

        var lockGrant = await OwnerLockGrantAsync("owner-lock-1");
        Assert.Equal(SharePassword, await Service().RevealAsync(_owner, _sharedId, lockGrant));
        await Items().GetAsync(_owner, _sharedId, null, 25, lockGrant);
    }

    // ---------- Members ----------

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AMember_NeedsIt_ForEveryContentPath_AndKeepsTheirRole(bool isContributor)
    {
        var member = isContributor ? _contributor : _viewer;
        await SetSharePasswordAsync();

        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetAsync(member, _sharedId, null, 25));
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Sections().GetAsync(member, _sharedId, "UTC"));
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetItemAsync(member, _sharedId, _ownerItem));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().UnlockAsync(member, _sharedId, "wrong-1"));

        var grant = await Service().UnlockAsync(member, _sharedId, SharePassword);
        Assert.Single((await Items().GetAsync(member, _sharedId, null, 25, grant.Token)).Items);
        Assert.NotEmpty(await Sections().GetAsync(member, _sharedId, "UTC", grant.Token));

        if (isContributor)
        {
            await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => _addItem.AddAsync(member, _sharedId, _contributorItem));
            await _addItem.AddAsync(member, _sharedId, _contributorItem, grant.Token);
        }
        else
        {
            // The password never adds a permission: a Viewer still cannot add.
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(member, _sharedId, _ownerItem, grant.Token));
        }
    }

    [Fact]
    public async Task ChangingIt_EndsEveryGrant_AndRemovingIt_OpensTheCollectionAgain_WithoutTouchingTheSharing()
    {
        await SetSharePasswordAsync();
        var grant = await Service().UnlockAsync(_viewer, _sharedId, SharePassword);
        await Items().GetAsync(_viewer, _sharedId, null, 25, grant.Token);

        await SetSharePasswordAsync("new-pass-2");
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetAsync(_viewer, _sharedId, null, 25, grant.Token));
        var newGrant = await Service().UnlockAsync(_viewer, _sharedId, "new-pass-2");
        await Items().GetAsync(_viewer, _sharedId, null, 25, newGrant.Token);

        await Service().RemoveAsync(_owner, _sharedId, null);
        _db.ChangeTracker.Clear();
        await Items().GetAsync(_viewer, _sharedId, null, 25);
        var row = await _db.CollectionSharePasswords.AsNoTracking().SingleAsync(entry => entry.CollectionId == _sharedId);
        Assert.Equal(CollectionSharePasswordMode.None, row.Mode);
        Assert.Null(row.PasswordHash);
        Assert.Null(row.EncryptedPassword);
        Assert.Equal(2, await _db.CollectionCollaborators.CountAsync(collaborator => collaborator.CollectionId == _sharedId));
    }

    [Fact]
    public async Task TheRightPassword_IsNothingWithoutAccess()
    {
        await SetSharePasswordAsync();
        await Service().SetAsync(_owner, _privateId, SharePassword, SharePassword, null);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().UnlockAsync(_stranger, _sharedId, SharePassword));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Service().UnlockAsync(_stranger, _privateId, SharePassword));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Items().GetAsync(_stranger, _sharedId, null, 25));
        Assert.False(await _db.CollectionCollaborators.AnyAsync(collaborator => collaborator.UserId == _stranger));
        Assert.False(await _db.CollectionUnlockThrottles.AnyAsync(throttle => throttle.CollectionId == _sharedId));
    }

    [Fact]
    public async Task FailedAttempts_ArePersisted_SoEveryReplicaEnforcesTheCooldown_AndASuccessClearsThem()
    {
        await SetSharePasswordAsync();
        for (var attempt = 0; attempt < CollectionUnlockThrottle.MaxFailures; attempt++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Service().UnlockAsync(_viewer, _sharedId, "wrong-" + attempt));
        }

        // Another API replica: its own DbContext and service instances, the same database.
        await using var otherReplica = NewContext(_db.Database.GetConnectionString()!);
        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => Service(otherReplica).UnlockAsync(_viewer, _sharedId, SharePassword));
        Assert.True(await _db.CollectionUnlockThrottles.AnyAsync(throttle => throttle.CollectionId == _sharedId && throttle.SubjectKey == $"su:{_viewer}"));

        // Another member is unaffected, and their success clears only their own counter.
        Assert.NotNull(await Service().UnlockAsync(_contributor, _sharedId, SharePassword));
        Assert.True(await _db.CollectionUnlockThrottles.AnyAsync(throttle => throttle.CollectionId == _sharedId && throttle.SubjectKey == $"su:{_viewer}"));
    }

    // ---------- Lock and share password stay separate ----------

    [Fact]
    public async Task ALockedCollection_NoLongerAsksItsMembersForTheOwnersPassword()
    {
        await LockUnderOwnerPasswordAsync("owner-lock-1");

        await Items().GetAsync(_viewer, _sharedId, null, 25);
        var lockService = LockService();
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => lockService.UnlockAsync(_viewer, _sharedId, "owner-lock-1"));
        Assert.False((await _collections.GetAsync(_viewer, _sharedId)).IsLocked);
        Assert.True((await _collections.GetAsync(_owner, _sharedId)).IsLocked);
    }

    [Fact]
    public async Task ALegacyCollection_KeepsItsProtection_UntilTheOwnerSetsASharePassword()
    {
        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await MarkLegacyAsync();

        await Assert.ThrowsAsync<CollectionLockedException>(() => Items().GetAsync(_viewer, _sharedId, null, 25));
        Assert.True((await _collections.GetAsync(_viewer, _sharedId)).IsLocked);
        var legacyGrant = await LockService().UnlockAsync(_viewer, _sharedId, "owner-lock-1");
        await Items().GetAsync(_viewer, _sharedId, null, 25, legacyGrant.Token);
        Assert.Equal("legacyCommonLock", (await Service().GetStatusAsync(_owner, _sharedId)).Mode);

        await SetSharePasswordAsync(unlockToken: await OwnerLockGrantAsync("owner-lock-1"));
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetAsync(_viewer, _sharedId, null, 25, legacyGrant.Token));
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => LockService().UnlockAsync(_viewer, _sharedId, "owner-lock-1"));
        var shareGrant = await Service().UnlockAsync(_viewer, _sharedId, SharePassword);
        await Items().GetAsync(_viewer, _sharedId, null, 25, shareGrant.Token);
    }

    [Fact]
    public async Task ALegacyCollection_TakesNoNewRecipients_WhileItsExistingOnesKeepTheirProtection()
    {
        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await MarkLegacyAsync();
        var newcomer = await NewUserAsync();
        var newcomerJupleId = await JupleIdOfAsync(newcomer);

        var invite = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            () => _collaboration.InviteAsync(_owner, _sharedId, newcomerJupleId, CollectionCollaboratorRole.Viewer));
        Assert.Equal(CollectionCollaborationConflictException.SharePasswordMigrationRequired, invite.Code);
        var link = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            () => _shares.EnableAsync(_owner, _sharedId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow));
        Assert.Equal(CollectionCollaborationConflictException.SharePasswordMigrationRequired, link.Code);
        _db.ChangeTracker.Clear();
        Assert.False(await _db.CollectionInvitations.AnyAsync(invitation => invitation.InvitedUserId == newcomer));
        Assert.False(await _db.CollectionShares.AnyAsync(share => share.CollectionId == _sharedId));

        // The recipients it already had are exactly as protected as before.
        await Assert.ThrowsAsync<CollectionLockedException>(() => Items().GetAsync(_viewer, _sharedId, null, 25));
        var legacyGrant = await LockService().UnlockAsync(_viewer, _sharedId, "owner-lock-1");
        await Items().GetAsync(_viewer, _sharedId, null, 25, legacyGrant.Token);
    }

    [Fact]
    public async Task ALegacyCollection_KeepsTheLinkItAlreadyHad_ButThatIsNoNewOne()
    {
        var publicId = Guid.NewGuid().ToString("N");
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow);
        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await MarkLegacyAsync();

        Assert.Equal(publicId, (await _shares.EnableAsync(_owner, _sharedId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow)).PublicId);
        Assert.True((await Public().GetCollectionAsync(publicId))!.IsLocked);
    }

    [Fact]
    public async Task ALegacyCollection_GivenItsOwnSharePassword_IsPerCollectionForGood_AndTakesNewRecipients()
    {
        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await MarkLegacyAsync();
        var newcomer = await NewUserAsync();

        await SetSharePasswordAsync(unlockToken: await OwnerLockGrantAsync("owner-lock-1"));
        _db.ChangeTracker.Clear();
        var before = await _db.CollectionSharePasswords.AsNoTracking().SingleAsync(row => row.CollectionId == _sharedId);
        Assert.Equal(CollectionSharePasswordMode.PerCollection, before.Mode);

        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(newcomer), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(newcomer, invitation.InvitationId);
        await _shares.EnableAsync(_owner, _sharedId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetAsync(newcomer, _sharedId, null, 25));
        var grant = await Service().UnlockAsync(newcomer, _sharedId, SharePassword);
        await Items().GetAsync(newcomer, _sharedId, null, 25, grant.Token);

        // The Owner's lock - its password changed, the lock removed and put back - never touches it.
        var lockPasswords = new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), _hasher, TimeProvider.System);
        await lockPasswords.ChangeAsync(_owner, "owner-lock-1", "owner-lock-2", "owner-lock-2");
        await LockService().RemoveAsync(_owner, _sharedId, "owner-lock-2");
        await LockService().LockAsync(_owner, _sharedId);
        _db.ChangeTracker.Clear();
        var after = await _db.CollectionSharePasswords.AsNoTracking().SingleAsync(row => row.CollectionId == _sharedId);
        Assert.Equal(CollectionSharePasswordMode.PerCollection, after.Mode);
        Assert.Equal(before.PasswordVersion, after.PasswordVersion);
        Assert.Equal(before.PasswordHash, after.PasswordHash);
        await Items().GetAsync(newcomer, _sharedId, null, 25, grant.Token);
    }

    [Fact]
    public async Task ALegacyCollection_WithItsProtectionTurnedOff_IsNoneForGood_AndTakesNewRecipients()
    {
        await LockUnderOwnerPasswordAsync("owner-lock-1");
        await MarkLegacyAsync();
        var newcomer = await NewUserAsync();

        await Service().RemoveAsync(_owner, _sharedId, await OwnerLockGrantAsync("owner-lock-1"));
        _db.ChangeTracker.Clear();
        Assert.Equal("none", (await Service().GetStatusAsync(_owner, _sharedId)).Mode);

        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(newcomer), CollectionCollaboratorRole.Viewer);
        await _shares.EnableAsync(_owner, _sharedId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow);
        // Its recipients open it with their access alone; only the Owner's own lock remains.
        await Items().GetAsync(_viewer, _sharedId, null, 25);
        await Assert.ThrowsAsync<CollectionLockedException>(() => Items().GetAsync(_owner, _sharedId, null, 25));

        // Locking it again never brings the legacy mode back.
        await LockService().RemoveAsync(_owner, _sharedId, "owner-lock-1");
        await LockService().LockAsync(_owner, _sharedId);
        _db.ChangeTracker.Clear();
        Assert.Equal(
            CollectionSharePasswordMode.None,
            (await _db.CollectionSharePasswords.AsNoTracking().SingleAsync(row => row.CollectionId == _sharedId)).Mode);
        await Items().GetAsync(_viewer, _sharedId, null, 25);
    }

    // ---------- Public link ----------

    [Fact]
    public async Task APublicLink_ShowsNothingUntilItIsProven_AndProvingItNeverWidensTheLink()
    {
        var publicId = Guid.NewGuid().ToString("N");
        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_viewer));
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow);
        await SetSharePasswordAsync();
        _db.ChangeTracker.Clear();

        var shell = await Public().GetCollectionAsync(publicId);
        Assert.Null(shell!.Name);
        Assert.True(shell.IsLocked);
        await Assert.ThrowsAsync<CollectionLockedException>(() => Public().GetItemsAsync(publicId, null, 25));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => Public().UnlockAsync(publicId, "wrong-1", "browser-attempt-000000000001"));

        var grant = await Public().UnlockAsync(publicId, SharePassword, "browser-attempt-000000000001");
        Assert.Equal("Trip", (await Public().GetCollectionAsync(publicId, grant!.Token))!.Name);
        Assert.Single((await Public().GetItemsAsync(publicId, null, 25, grant.Token))!.Items);

        // The anonymous grant opens nothing else - not the in-app content of any user.
        await Assert.ThrowsAsync<CollectionSharePasswordRequiredException>(() => Items().GetAsync(_contributor, _sharedId, null, 25, grant.Token));

        // A read-only link stays read-only for a signed-in holder of the grant.
        var write = new PublicCollectionWriteService(new PublicCollectionStore(_db), _collections, Tokens(), TimeProvider.System);
        await Assert.ThrowsAsync<PublicShareReadOnlyException>(() => write.AddItemAsync(_stranger, publicId, _contributorItem, grant.Token));
    }

    [Fact]
    public async Task AWritableLink_StillNeedsASignedInAccount_AndTheGrant()
    {
        var publicId = Guid.NewGuid().ToString("N");
        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_viewer));
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow, CollectionSharePermission.Write);
        await SetSharePasswordAsync();
        _db.ChangeTracker.Clear();
        var strangerItem = (await new ItemStore(_db).SaveAsync(_stranger, "https://example.test/stranger", null, DateTimeOffset.UtcNow)).Entry.Id;
        var write = new PublicCollectionWriteService(new PublicCollectionStore(_db), _collections, Tokens(), TimeProvider.System);

        await Assert.ThrowsAsync<CollectionLockedException>(() => write.AddItemAsync(_stranger, publicId, strangerItem, null));
        var grant = await Public().UnlockAsync(publicId, SharePassword, "browser-attempt-000000000002");
        Assert.True(await write.AddItemAsync(_stranger, publicId, strangerItem, grant!.Token));
        // Adding through the link made nobody a member.
        Assert.False(await _db.CollectionCollaborators.AnyAsync(collaborator => collaborator.UserId == _stranger));
    }

    // ---------- helpers ----------

    private CollectionLockService LockService()
    {
        var lockStore = new CollectionLockStore(_db);
        return new CollectionLockService(
            Access(), lockStore, new CollectionLockSettingsStore(_db), new CollectionPasswordVerifier(lockStore, _hasher), Tokens(), TimeProvider.System);
    }

    private async Task LockUnderOwnerPasswordAsync(string password)
    {
        await new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), _hasher, TimeProvider.System)
            .ResetAsync(_owner, password, password, DateTimeOffset.UtcNow);
        await LockService().LockAsync(_owner, _sharedId);
        _db.ChangeTracker.Clear();
    }

    /// <summary>What the migration does for a Collection that was locked and already had recipients.</summary>
    private async Task MarkLegacyAsync()
    {
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionSharePasswords (CollectionId, Mode, PasswordVersion, CreatedAtUtc, UpdatedAtUtc) VALUES ({_sharedId}, 'LegacyCommonLock', 1, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})");
        _db.ChangeTracker.Clear();
    }

    private async Task<string> OwnerLockGrantAsync(string password) =>
        (await LockService().UnlockAsync(_owner, _sharedId, password)).Token;

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"items/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.FromResult<Uri?>(null);
    }
}
