using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
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
/// Against a real SQL Server schema: the Owner's one Collection lock password - the transition from
/// legacy per-Collection passwords (A-F), reuse of an existing Round 5 row, reset after a recent
/// sign-in - and the Share screen's 읽기 (Viewer) / 쓰기 (Contributor) role changes with their
/// public-link rules.
/// </summary>
public sealed class CollectionLockPasswordAndRoleIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _reader;
    private long _writer;
    private long _stranger;
    private long _sharedId;
    private long _ownerItem;
    private long _writerItem;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionLockService _locks = null!;
    private CollectionLockPasswordService _lockPasswords = null!;
    private GetCollectionItemsService _items = null!;
    private AddItemToCollectionService _addItem = null!;
    private PublicCollectionService _public = null!;
    private CollectionShareStore _shares = null!;
    private ItemStore _itemStore = null!;
    private readonly CollectionLockPasswordHasher _hasher = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _reader = await NewUserAsync();
        _writer = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _itemStore = new ItemStore(_db);
        _shares = new CollectionShareStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var lockStore = new CollectionLockStore(_db);
        var verifier = new CollectionPasswordVerifier(lockStore, _hasher);
        _access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            _access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _locks = new CollectionLockService(_access, lockStore, new CollectionLockSettingsStore(_db), verifier, tokens, TimeProvider.System);
        _lockPasswords = new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), _hasher, TimeProvider.System);
        _items = new GetCollectionItemsService(_access, _collections, new FakeImageStorage());
        _addItem = new AddItemToCollectionService(_access, _collections, TimeProvider.System);
        _public = new PublicCollectionService(new PublicCollectionStore(_db), lockStore, verifier, tokens, TimeProvider.System);

        _sharedId = await NewCollectionAsync("Shared");
        _ownerItem = await NewItemAsync(_owner, "https://example.test/owner");
        _writerItem = await NewItemAsync(_writer, "https://example.test/writer");
        await _addItem.AddAsync(_owner, _sharedId, _ownerItem);
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

    // ---------- A. no lock password yet: legacy per-Collection passwords keep working ----------

    [Fact]
    public async Task A_WithoutALockPassword_LegacyPerCollectionPasswordsKeepWorking_AndNewLocksWaitForOne()
    {
        var a = await NewLegacyLockedAsync("A", "aaa-legacy");
        var b = await NewLegacyLockedAsync("B", "bbb-legacy");

        Assert.NotNull(await _locks.UnlockAsync(_owner, a, "aaa-legacy"));
        Assert.NotNull(await _locks.UnlockAsync(_owner, b, "bbb-legacy"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, a, "bbb-legacy"));

        // E (before setup): locking anything else first needs the account's lock password.
        await Assert.ThrowsAsync<CollectionLockPasswordNotConfiguredException>(() => _locks.LockAsync(_owner, _sharedId));
        Assert.False((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).IsLocked);
    }

    // ---------- B. setting it takes over every locked Collection at once ----------

    [Fact]
    public async Task B_SettingTheLockPassword_OpensEveryLockedCollection_OldPasswordsAndGrantsStopWorking()
    {
        var a = await NewLegacyLockedAsync("A", "aaa-legacy");
        var b = await NewLegacyLockedAsync("B", "bbb-legacy");
        var grantA = await _locks.UnlockAsync(_owner, a, "aaa-legacy");
        var versionsBefore = await LockVersionsAsync(a, b);

        await _lockPasswords.ResetAsync(_owner, "common-pass-1", "common-pass-1", DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        Assert.Equal(versionsBefore.Select(version => version + 1), await LockVersionsAsync(a, b));
        foreach (var collectionId in new[] { a, b })
        {
            Assert.NotNull(await _locks.UnlockAsync(_owner, collectionId, "common-pass-1"));
        }

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, a, "aaa-legacy"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, b, "bbb-legacy"));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, a, null, 50, grantA.Token));

        // Stored one-way only; the legacy hashes are left in place (ignored, never dropped here).
        var row = await _db.UserCollectionLockSettings.AsNoTracking().SingleAsync(entry => entry.UserId == _owner);
        Assert.DoesNotContain("common-pass-1", row.PasswordHash);
        Assert.NotNull((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == a)).LockPasswordHash);
    }

    // ---------- C. change ----------

    [Fact]
    public async Task C_ChangingTheLockPassword_MovesEveryLockedCollection_AndTheOldOneFails()
    {
        await LockUnderOwnerPasswordAsync(_sharedId, "common-pass-1");
        var other = await NewCollectionAsync("Other");
        await _locks.LockAsync(_owner, other);
        _db.ChangeTracker.Clear();
        var grant = await _locks.UnlockAsync(_owner, other, "common-pass-1");

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() =>
            _lockPasswords.ChangeAsync(_owner, "not-the-one", "common-pass-2", "common-pass-2"));
        await _lockPasswords.ChangeAsync(_owner, "common-pass-1", "common-pass-2", "common-pass-2");
        _db.ChangeTracker.Clear();

        foreach (var collectionId in new[] { _sharedId, other })
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, collectionId, "common-pass-1"));
            Assert.NotNull(await _locks.UnlockAsync(_owner, collectionId, "common-pass-2"));
        }

        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, other, null, 50, grant.Token));
    }

    [Fact]
    public async Task C_WrongCurrentPasswords_AreThrottledAcrossRequests()
    {
        await LockUnderOwnerPasswordAsync(_sharedId, "common-pass-1");
        for (var attempt = 0; attempt < CollectionUnlockThrottle.MaxFailures; attempt++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() =>
                _lockPasswords.ChangeAsync(_owner, "guess-" + attempt, "common-pass-2", "common-pass-2"));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() =>
            _lockPasswords.ChangeAsync(_owner, "common-pass-1", "common-pass-2", "common-pass-2"));
    }

    // ---------- D. reset after a recent sign-in ----------

    [Fact]
    public async Task D_Reset_NeedsARecentSignIn_ThenReplacesTheSameRow_AndRevokesGrants()
    {
        await LockUnderOwnerPasswordAsync(_sharedId, "forgotten-1");
        var createdAt = (await _db.UserCollectionLockSettings.AsNoTracking().SingleAsync(entry => entry.UserId == _owner)).CreatedAtUtc;
        var grant = await _locks.UnlockAsync(_owner, _sharedId, "forgotten-1");

        foreach (var signedInAt in new DateTimeOffset?[] { null, DateTimeOffset.UtcNow.AddMinutes(-6), DateTimeOffset.UtcNow.AddMinutes(5) })
        {
            await Assert.ThrowsAsync<RecentAuthenticationRequiredException>(() =>
                _lockPasswords.ResetAsync(_owner, "brand-new-1", "brand-new-1", signedInAt));
        }

        Assert.NotNull(await _locks.UnlockAsync(_owner, _sharedId, "forgotten-1"));
        await _lockPasswords.ResetAsync(_owner, "brand-new-1", "brand-new-1", DateTimeOffset.UtcNow.AddSeconds(-20));
        _db.ChangeTracker.Clear();

        var row = await _db.UserCollectionLockSettings.AsNoTracking().SingleAsync(entry => entry.UserId == _owner);
        Assert.Equal(createdAt, row.CreatedAtUtc);
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, _sharedId, "forgotten-1"));
        Assert.NotNull(await _locks.UnlockAsync(_owner, _sharedId, "brand-new-1"));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, _sharedId, null, 50, grant.Token));
    }

    [Fact]
    public async Task D_AnExistingRound5Row_IsTheLockPassword_AndCanBeReset()
    {
        // The DEV situation: a Round 5 row plus Collections that later got their own (Round 6/7) passwords.
        await SeedRound5RowAsync("round5-pass", DateTimeOffset.UtcNow.AddDays(-3));
        var newer = await NewLegacyLockedAsync("Newer own password", "own-newer-1");

        Assert.NotNull(await _locks.UnlockAsync(_owner, newer, "round5-pass"));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_owner, newer, "own-newer-1"));

        await _lockPasswords.ResetAsync(_owner, "after-reset-1", "after-reset-1", DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.UserCollectionLockSettings.CountAsync(entry => entry.UserId == _owner));
        Assert.NotNull(await _locks.UnlockAsync(_owner, newer, "after-reset-1"));
    }

    // ---------- E. new locks ----------

    [Fact]
    public async Task E_ANewLock_CreatesNoPasswordOfItsOwn()
    {
        await LockUnderOwnerPasswordAsync(_sharedId, "common-pass-1");

        var collection = await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId);
        Assert.True(collection.IsLocked);
        Assert.Null(collection.LockPasswordHash);
        Assert.NotNull(await _locks.UnlockAsync(_owner, _sharedId, "common-pass-1"));

        // Removing it needs that password - the Owner included.
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.RemoveAsync(_owner, _sharedId, "wrong-pass-1"));
        await _locks.RemoveAsync(_owner, _sharedId, "common-pass-1");
        Assert.False((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).IsLocked);
    }

    // ---------- F. shared and public locks ----------

    [Fact]
    public async Task F_MembersAndPublicLinksUseTheOwnersPassword_WhichGrantsNoOtherAccess()
    {
        await InviteAndAcceptAsync(_reader, CollectionCollaboratorRole.Viewer);
        var privateOne = await NewCollectionAsync("Private");
        await LockUnderOwnerPasswordAsync(_sharedId, "common-pass-1");
        await _locks.LockAsync(_owner, privateOne);
        var publicId = NewPublicId();
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        var grant = await _locks.UnlockAsync(_reader, _sharedId, "common-pass-1");
        Assert.Single((await _items.GetAsync(_reader, _sharedId, null, 50, grant.Token)).Items);
        var publicGrant = await _public.UnlockAsync(publicId, "common-pass-1");
        Assert.Equal("Shared", (await _public.GetCollectionAsync(publicId, publicGrant!.Token))!.Name);

        // The same password opens nothing the caller has no access to, and no more than their role.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _locks.UnlockAsync(_reader, privateOne, "common-pass-1"));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _locks.UnlockAsync(_stranger, _sharedId, "common-pass-1"));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _locks.RemoveAsync(_reader, _sharedId, "common-pass-1"));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _locks.LockAsync(_reader, _sharedId));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(_reader, _sharedId, _writerItem, grant.Token));

        // A change revokes the public link's grant too.
        await _lockPasswords.ChangeAsync(_owner, "common-pass-1", "common-pass-2", "common-pass-2");
        _db.ChangeTracker.Clear();
        Assert.Equal(new PublicCollectionDto(null, true), await _public.GetCollectionAsync(publicId, publicGrant.Token));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _public.UnlockAsync(publicId, "common-pass-1"));
    }

    [Fact]
    public async Task AccountDeletion_RemovesTheLockPasswordRow()
    {
        await LockUnderOwnerPasswordAsync(_sharedId, "common-pass-1");

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_owner);

        Assert.False(await _db.UserCollectionLockSettings.AnyAsync(entry => entry.UserId == _owner));
        Assert.False(await _db.Collections.AnyAsync(entry => entry.UserId == _owner));
    }

    // ---------- 읽기 / 쓰기 roles ----------

    [Fact]
    public async Task ReadAndWriteInvitations_MapToViewerAndContributor_AndMemberRoleChangesApplyImmediately()
    {
        var read = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_reader), CollectionCollaboratorRole.Viewer);
        var write = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_writer), CollectionCollaboratorRole.Contributor);
        Assert.Equal("Viewer", read.Role);
        Assert.Equal("Contributor", write.Role);
        await _collaboration.AcceptInvitationAsync(_reader, read.InvitationId);
        await _collaboration.AcceptInvitationAsync(_writer, write.InvitationId);

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(_reader, _sharedId, _writerItem));
        await _addItem.AddAsync(_writer, _sharedId, _writerItem);

        // 쓰기 → 읽기: the very next request is refused; the links they already added stay.
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_writer), CollectionCollaboratorRole.Viewer);
        _db.ChangeTracker.Clear();
        Assert.Equal(CollectionAccessRole.Viewer, (await _access.RequireAsync(_writer, _sharedId, CollectionPermission.View)).Role);
        var another = await NewItemAsync(_writer, "https://example.test/writer-2");
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(_writer, _sharedId, another));
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _writerItem));

        // 읽기 → 쓰기: allowed at once.
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_reader), CollectionCollaboratorRole.Contributor);
        _db.ChangeTracker.Clear();
        var readerItem = await NewItemAsync(_reader, "https://example.test/reader");
        await _addItem.AddAsync(_reader, _sharedId, readerItem);

        var participants = await _collaboration.GetParticipantsAsync(_owner, _sharedId);
        Assert.Equal(CollectionDtoAccessRoles.Owner, participants.Participants[0].Role);
        Assert.Equal(CollectionDtoAccessRoles.Viewer, await RoleOfAsync(participants, _writer));
        Assert.Equal(CollectionDtoAccessRoles.Contributor, await RoleOfAsync(participants, _reader));
    }

    [Fact]
    public async Task PendingInvitationRole_CanBeChanged_AndAcceptingUsesTheNewRole()
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_reader), CollectionCollaboratorRole.Viewer);
        await _collaboration.ChangeInvitationRoleAsync(_owner, _sharedId, invitation.InvitationId, CollectionCollaboratorRole.Contributor);
        _db.ChangeTracker.Clear();

        var received = Assert.Single(await _collaboration.ListReceivedInvitationsAsync(_reader));
        Assert.Equal("Contributor", received.Role);
        Assert.Equal("Contributor", Assert.Single((await _collaboration.GetParticipantsAsync(_owner, _sharedId)).PendingInvitations).Role);

        await _collaboration.AcceptInvitationAsync(_reader, invitation.InvitationId);
        Assert.Equal(CollectionAccessRole.Contributor, (await _access.RequireAsync(_reader, _sharedId, CollectionPermission.View)).Role);

        // Once answered it can no longer be changed.
        var answered = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.ChangeInvitationRoleAsync(_owner, _sharedId, invitation.InvitationId, CollectionCollaboratorRole.Viewer));
        Assert.Equal(CollectionCollaborationConflictException.InvitationNotPending, answered.Code);
    }

    [Fact]
    public async Task RevokeRemoveDuplicateAndSelf_KeepTheirRules_AndRoleChangesAreOwnerOnly()
    {
        var readerId = await JupleIdOfAsync(_reader);
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, readerId, CollectionCollaboratorRole.Viewer);
        var duplicate = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, readerId, CollectionCollaboratorRole.Contributor));
        Assert.Equal(CollectionCollaborationConflictException.InvitationPending, duplicate.Code);
        var ownerJupleId = await JupleIdOfAsync(_owner);
        var writerJupleId = await JupleIdOfAsync(_writer);
        var strangerJupleId = await JupleIdOfAsync(_stranger);
        var self = await Assert.ThrowsAsync<InvalidCollectionException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, ownerJupleId, CollectionCollaboratorRole.Viewer));
        Assert.Equal("jupleId", self.Field);

        await _collaboration.RevokeInvitationAsync(_owner, _sharedId, invitation.InvitationId);
        Assert.Empty(await _collaboration.ListReceivedInvitationsAsync(_reader));

        await InviteAndAcceptAsync(_writer, CollectionCollaboratorRole.Contributor);
        var member = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, writerJupleId, CollectionCollaboratorRole.Viewer));
        Assert.Equal(CollectionCollaborationConflictException.AlreadyCollaborator, member.Code);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            _collaboration.ChangeCollaboratorRoleAsync(_writer, _sharedId, writerJupleId, CollectionCollaboratorRole.Contributor));
        await Assert.ThrowsAsync<CollectionCollaboratorNotFoundException>(() =>
            _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, strangerJupleId, CollectionCollaboratorRole.Viewer));
        // The Owner has no member row - their own role can never be changed.
        await Assert.ThrowsAsync<CollectionCollaboratorNotFoundException>(() =>
            _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, ownerJupleId, CollectionCollaboratorRole.Viewer));

        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, writerJupleId);
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _access.RequireAsync(_writer, _sharedId, CollectionPermission.View));
    }

    [Fact]
    public async Task PublicLink_CoexistsWithReaders_ButNeverWithWriters_AndNothingIsSwitchedOffAutomatically()
    {
        // A read member and a pending read invitation: the public link is allowed.
        await InviteAndAcceptAsync(_reader, CollectionCollaboratorRole.Viewer);
        var pendingRead = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_writer), CollectionCollaboratorRole.Viewer);
        var publicId = NewPublicId();
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow);

        // While it is on, nobody can be made a writer - and nothing changes to make room.
        var readerJupleId = await JupleIdOfAsync(_reader);
        var strangerJupleId = await JupleIdOfAsync(_stranger);
        var memberToWrite = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, readerJupleId, CollectionCollaboratorRole.Contributor));
        var pendingToWrite = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.ChangeInvitationRoleAsync(_owner, _sharedId, pendingRead.InvitationId, CollectionCollaboratorRole.Contributor));
        var inviteWriter = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, strangerJupleId, CollectionCollaboratorRole.Contributor));
        Assert.All(new[] { memberToWrite, pendingToWrite, inviteWriter },
            exception => Assert.Equal(CollectionCollaborationConflictException.PublicShareActive, exception.Code));
        _db.ChangeTracker.Clear();
        Assert.NotNull(await new PublicCollectionStore(_db).GetStateAsync(publicId));
        Assert.Equal(CollectionAccessRole.Viewer, (await _access.RequireAsync(_reader, _sharedId, CollectionPermission.View)).Role);
        Assert.Equal("Viewer", Assert.Single((await _collaboration.GetParticipantsAsync(_owner, _sharedId)).PendingInvitations).Role);

        // With the link off: a pending writer blocks turning it back on, and so does a writer member.
        await _shares.RevokeAsync(_owner, _sharedId, DateTimeOffset.UtcNow);
        await _collaboration.ChangeInvitationRoleAsync(_owner, _sharedId, pendingRead.InvitationId, CollectionCollaboratorRole.Contributor);
        var pendingWriterBlocks = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow));
        Assert.Equal(CollectionCollaborationConflictException.CollaborationActive, pendingWriterBlocks.Code);

        await _collaboration.ChangeInvitationRoleAsync(_owner, _sharedId, pendingRead.InvitationId, CollectionCollaboratorRole.Viewer);
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, readerJupleId, CollectionCollaboratorRole.Contributor);
        var writerMemberBlocks = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow));
        Assert.Equal(CollectionCollaborationConflictException.CollaborationActive, writerMemberBlocks.Code);

        // Back to 읽기: allowed again.
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, readerJupleId, CollectionCollaboratorRole.Viewer);
        Assert.NotNull(await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task ReaderMembers_AlongsideThePublicLink_NeverLeakAMembersOwnLinks()
    {
        // A former writer's link stays in the Collection after they become a reader, but the public
        // page only ever publishes the Owner's own Items.
        await InviteAndAcceptAsync(_writer, CollectionCollaboratorRole.Contributor);
        await _addItem.AddAsync(_writer, _sharedId, _writerItem);
        await _collaboration.ChangeCollaboratorRoleAsync(_owner, _sharedId, await JupleIdOfAsync(_writer), CollectionCollaboratorRole.Viewer);
        var publicId = NewPublicId();
        await _shares.EnableAsync(_owner, _sharedId, publicId, DateTimeOffset.UtcNow);

        var item = Assert.Single((await _public.GetItemsAsync(publicId, null, 50))!.Items);
        Assert.Equal("https://example.test/owner", item.Url);
    }

    // ---------- helpers ----------

    private async Task<string> RoleOfAsync(CollectionParticipantsDto participants, long userId)
    {
        var jupleId = await JupleIdOfAsync(userId);
        return participants.Participants.Single(participant => participant.JupleId == jupleId).Role;
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewCollectionAsync(string name) =>
        (await _collections.CreateAsync(_owner, name, name.ToUpperInvariant(), CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

    /// <summary>A Collection locked with its own password - the Round 6/7 per-Collection model, reproduced as data.</summary>
    private async Task<long> NewLegacyLockedAsync(string name, string password)
    {
        var collectionId = await NewCollectionAsync(name);
        var hash = _hasher.Hash(password);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.Collections SET IsLocked = 1, LockPasswordHash = {hash}, LockPasswordChangedAtUtc = {DateTimeOffset.UtcNow}, LockVersion = LockVersion + 1 WHERE Id = {collectionId}");
        return collectionId;
    }

    /// <summary>Reproduces a lock password row written in the Round 5 period - the same row the product uses now.</summary>
    private async Task SeedRound5RowAsync(string password, DateTimeOffset createdAtUtc)
    {
        _db.UserCollectionLockSettings.Add(new UserCollectionLockSettings(_owner, _hasher.Hash(password), createdAtUtc));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
    }

    /// <summary>Settings > 컬렉션 잠금 right after a real sign-in, then locking the Collection under that password.</summary>
    private async Task LockUnderOwnerPasswordAsync(long collectionId, string password)
    {
        await _lockPasswords.ResetAsync(_owner, password, password, DateTimeOffset.UtcNow);
        await _locks.LockAsync(_owner, collectionId);
        _db.ChangeTracker.Clear();
    }

    private async Task<int[]> LockVersionsAsync(params long[] collectionIds)
    {
        var versions = await _db.Collections.AsNoTracking()
            .Where(entry => collectionIds.Contains(entry.Id))
            .ToDictionaryAsync(entry => entry.Id, entry => entry.LockVersion);
        return collectionIds.Select(id => versions[id]).ToArray();
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await _itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        var item = await _db.Items.SingleAsync(entry => entry.Id == saved.Entry.Id);
        item.UpdateDetails("Title of " + url, null);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private static string NewPublicId() => Guid.NewGuid().ToString("N");

    private sealed class FakeImageStorage : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }
}
