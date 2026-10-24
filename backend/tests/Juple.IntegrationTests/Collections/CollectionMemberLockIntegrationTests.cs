using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Items;
using Juple.Application.Collections.Locking;
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
/// A member's PERSONAL lock on a Collection someone else owns: a protection of that person's own access only. It opens with their own
/// lock password, is invisible to the Owner and every other member, never leaves / hides / changes the Collection, and cannot be
/// bypassed from the list, Home / Archive, search or a deep link (all of which read the same gate).
/// </summary>
public sealed class CollectionMemberLockIntegrationTests : IAsyncLifetime
{
    private const string Password = "my-own-lock-1";

    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _otherMember;
    private long _stranger;
    private long _collectionId;
    private long _memberItem;
    private long _ownerItem;
    private CollectionStore _collections = null!;
    private ItemStore _itemStore = null!;
    private CollectionAccessService _access = null!;
    private CollectionLockService _locks = null!;
    private CollectionLockPasswordService _passwords = null!;
    private GetCollectionItemsService _items = null!;
    private AddItemToCollectionService _addItem = null!;
    private CollectionUnlockTokenProtector _tokens = null!;
    private readonly CollectionLockPasswordHasher _hasher = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _otherMember = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _itemStore = new ItemStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var lockStore = new CollectionLockStore(_db);
        var settings = new CollectionLockSettingsStore(_db);
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _locks = new CollectionLockService(_access, lockStore, settings, new CollectionPasswordVerifier(lockStore, _hasher), _tokens, TimeProvider.System);
        _passwords = new CollectionLockPasswordService(settings, _hasher, TimeProvider.System);
        var collaboration = new CollectionCollaborationService(
            _access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _items = new GetCollectionItemsService(_access, _collections, new NoImages());
        _addItem = new AddItemToCollectionService(_access, _collections, TimeProvider.System);

        _collectionId = (await _collections.CreateAsync(_owner, "Shared trip", "SHARED TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        foreach (var user in new[] { _member, _otherMember })
        {
            var invitation = await collaboration.InviteAsync(_owner, _collectionId, await JupleIdOfAsync(user), CollectionCollaboratorRole.Contributor);
            await collaboration.AcceptInvitationAsync(user, invitation.InvitationId);
        }

        _ownerItem = await NewItemAsync(_owner, "https://example.test/owner-link");
        _memberItem = await NewItemAsync(_member, "https://example.test/member-link");
        await _addItem.AddAsync(_owner, _collectionId, _ownerItem);
        await _addItem.AddAsync(_member, _collectionId, _memberItem);
        _db.ChangeTracker.Clear();
        await _passwords.ResetAsync(_member, Password, Password, DateTimeOffset.UtcNow);
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

    [Fact]
    public async Task ALockedMember_NeedsTheirOwnPasswordForTheContent_ButCanStillSeeTheCard()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();

        // The card is there and says locked (for this person), the Collection is not left or changed.
        var card = await _collections.GetAsync(_member, _collectionId);
        Assert.True(card.IsLocked);
        Assert.True(card.IsMemberLocked);
        Assert.Equal("contributor", card.AccessRole);
        // The content, adding, removing: all behind the lock.
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_member, _collectionId, null, 25));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _addItem.AddAsync(_member, _collectionId, _memberItem));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _access.RequireContentAsync(_member, _collectionId, null));
    }

    [Fact]
    public async Task OnlyTheirOwnPasswordOpensIt_AndTheGrantIsTheirsAlone()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_member, _collectionId, "not-it"));
        var grant = await _locks.UnlockAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();

        var page = await _items.GetAsync(_member, _collectionId, null, 25, grant.Token);
        Assert.Equal(2, page.Items.Count);
        // A grant is for that person and that kind: another member's access is not touched by it, and it is not the Collection lock's kind.
        await _access.RequireContentAsync(_otherMember, _collectionId, grant.Token);
        Assert.False(_tokens.IsValid(grant.Token, _collectionId, CollectionUnlockSubject.ForUser(_member), 1, DateTimeOffset.UtcNow, CollectionUnlockPurpose.CollectionLock));
        Assert.True(_tokens.IsValid(grant.Token, _collectionId, CollectionUnlockSubject.ForUser(_member), 1, DateTimeOffset.UtcNow, CollectionUnlockPurpose.MemberLock));
        Assert.False(_tokens.IsValid(grant.Token, _collectionId, CollectionUnlockSubject.ForUser(_otherMember), 1, DateTimeOffset.UtcNow, CollectionUnlockPurpose.MemberLock));
    }

    [Fact]
    public async Task NobodyElseIsAffected_NotTheOwner_NotOtherMembers_AndNothingIsReportedToThem()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();

        foreach (var other in new[] { _owner, _otherMember })
        {
            var page = await _items.GetAsync(other, _collectionId, null, 25);
            Assert.Equal(2, page.Items.Count);
            var card = await _collections.GetAsync(other, _collectionId);
            Assert.False(card.IsLocked);
            Assert.False(card.IsMemberLocked);
        }

        var ownerCard = await _collections.GetAsync(_owner, _collectionId);
        Assert.False(ownerCard.HasCollaborators == false, "the Owner still sees the Collection as shared");
        // Membership is unchanged: the person is still a member (a lock is not leaving).
        Assert.True(await _db.CollectionCollaborators.AnyAsync(row => row.CollectionId == _collectionId && row.UserId == _member));
    }

    [Fact]
    public async Task TheOwnerAndAStranger_CannotUseThePersonalLock()
    {
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _locks.LockForMemberAsync(_owner, _collectionId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _locks.LockForMemberAsync(_stranger, _collectionId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _locks.RemoveForMemberAsync(_stranger, _collectionId, Password));
        await Assert.ThrowsAsync<CollectionNotLockedException>(() => _locks.UnlockAsync(_member, _collectionId, Password));
        Assert.False(await _db.CollectionMemberLocks.AnyAsync(row => row.CollectionId == _collectionId));
    }

    [Fact]
    public async Task WithoutALockPassword_ItCannotBeSet()
    {
        await Assert.ThrowsAsync<CollectionLockPasswordNotConfiguredException>(() => _locks.LockForMemberAsync(_otherMember, _collectionId));
        Assert.False(await _db.CollectionMemberLocks.AnyAsync(row => row.UserId == _otherMember));
    }

    [Fact]
    public async Task RemovingItNeedsThePassword_AndOldGrantsDieWithTheLock()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        var grant = await _locks.UnlockAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.RemoveForMemberAsync(_member, _collectionId, "wrong"));
        await _locks.RemoveForMemberAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();
        Assert.False((await _collections.GetAsync(_member, _collectionId)).IsMemberLocked);
        Assert.Equal(2, (await _items.GetAsync(_member, _collectionId, null, 25)).Items.Count);

        // Locking again is a NEW lock: the grant from before does not open it.
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_member, _collectionId, null, 25, grant.Token));
    }

    [Fact]
    public async Task ChangingTheLockPassword_EndsOutstandingGrants()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        var grant = await _locks.UnlockAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();
        Assert.Equal(2, (await _items.GetAsync(_member, _collectionId, null, 25, grant.Token)).Items.Count);

        await _passwords.ChangeAsync(_member, Password, "another-lock-2", "another-lock-2");
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_member, _collectionId, null, 25, grant.Token));
        var fresh = await _locks.UnlockAsync(_member, _collectionId, "another-lock-2");
        Assert.Equal(2, (await _items.GetAsync(_member, _collectionId, null, 25, fresh.Token)).Items.Count);
    }

    [Fact]
    public async Task HomeArchiveAndSearch_DoNotRevealTheMembersOwnLinkInALockedCollection()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();

        var history = await _itemStore.GetHistoryAsync(_member, null, 50);
        var card = Assert.Single(history.Page.Items, entry => entry.Id == _memberItem);
        Assert.True(card.IsCollectionLocked);
        Assert.Equal("lock", card.CollectionGate);
        Assert.Equal(_collectionId, card.CollectionId);
        Assert.Equal(string.Empty, card.Url);
        Assert.Null(card.Title);

        // A search never finds a hidden address.
        var pattern = ItemSearchPattern.ToContainsPattern("member-link");
        var found = await _itemStore.GetHistoryAsync(_member, null, 50, pattern);
        Assert.DoesNotContain(found.Page.Items, entry => entry.Id == _memberItem);

        // Someone else's view of their own links is unaffected.
        var ownerHistory = await _itemStore.GetHistoryAsync(_owner, null, 50);
        Assert.False(Assert.Single(ownerHistory.Page.Items, entry => entry.Id == _ownerItem).IsCollectionLocked);

        // Once removed, the card is ordinary again.
        await _locks.RemoveForMemberAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();
        var after = await _itemStore.GetHistoryAsync(_member, null, 50);
        Assert.False(Assert.Single(after.Page.Items, entry => entry.Id == _memberItem).IsCollectionLocked);
    }

    [Fact]
    public async Task TheCollectionList_AndRecentlyOpened_FollowTheSameGate()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();
        var recent = new RecentlyOpenedItemStore(_db);
        await recent.RecordOpenAsync(_member, _memberItem, DateTimeOffset.UtcNow);

        var list = await _collections.ListByScopeAsync(_member, CollectionListScope.All, null, null, null, 50);
        Assert.True(Assert.Single(list.Items, entry => entry.Id == _collectionId).IsLocked);
        Assert.Empty((await recent.GetPageAsync(_member, null, 50)).Items);

        var search = await _collections.ListByScopeAsync(_member, CollectionListScope.All, null, null, null, 50, search: Search("member-link"));
        Assert.DoesNotContain(search.Items, entry => entry.Id == _collectionId);

        await _locks.RemoveForMemberAsync(_member, _collectionId, Password);
        _db.ChangeTracker.Clear();
        Assert.Equal(1, await _db.RecentlyOpenedItems.CountAsync(row => row.UserId == _member));
        Assert.False(await _db.CollectionMemberLocks.AnyAsync(row => row.UserId == _member && row.IsLocked));
        Assert.Single((await recent.GetPageAsync(_member, null, 50)).Items);
    }

    [Fact]
    public async Task LeavingOrBeingRemoved_DropsThePersonalLock_AndAccountDeletionClearsIt()
    {
        await _locks.LockForMemberAsync(_member, _collectionId);
        _db.ChangeTracker.Clear();
        var collaboration = new CollectionCollaborationStore(_db);

        await collaboration.RemoveCollaboratorAsync(_collectionId, _member);
        _db.ChangeTracker.Clear();

        Assert.False(await _db.CollectionMemberLocks.AnyAsync(row => row.CollectionId == _collectionId && row.UserId == _member));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_member, _collectionId, null, 25));
    }

    private static CollectionListSearch Search(string term)
    {
        Assert.True(CollectionListSearch.TryCreate(term, out var search));
        return search!;
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) => (await _db.Users.AsNoTracking().SingleAsync(user => user.Id == userId)).PublicCode;

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await _itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private sealed class NoImages : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }
}
