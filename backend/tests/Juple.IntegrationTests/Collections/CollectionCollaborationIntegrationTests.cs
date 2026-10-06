using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.ListCollections;
using Juple.Application.Collections.Locking;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.SetCollectionIconImage;
using Juple.Application.Images;
using Juple.Application.Items;
using Juple.Domain.Collections;
using Juple.Domain.Images;
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
/// Collaboration / lock / public-share security boundaries against a real SQL Server schema: the
/// row filtering and privacy projection live in SQL, so they are verified here, through the same
/// Application services + Infrastructure stores production wires together.
/// </summary>
public sealed class CollectionCollaborationIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _contributor;
    private long _stranger;
    private long _sharedId;      // Owner's Collection shared with _contributor
    private long _ownerOtherId;  // Owner's other, unshared Collection
    private long _contributorOwnId;
    private long _ownerItemInShared;
    private long _ownerItemElsewhere;
    private long _contributorItem;
    private long _contributorOtherItem;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionLockService _locks = null!;
    private GetCollectionItemsService _items = null!;
    private AddItemToCollectionService _addItem = null!;
    private PublicCollectionService _public = null!;
    private CollectionShareStore _shares = null!;
    private ItemStore _itemStore = null!;
    private CollectionUnlockTokenProtector _tokens = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _contributor = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _itemStore = new ItemStore(_db);
        _shares = new CollectionShareStore(_db);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var lockStore = new CollectionLockStore(_db);
        var hasher = new CollectionLockPasswordHasher();
        var verifier = new CollectionPasswordVerifier(lockStore, hasher);
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            _access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _locks = new CollectionLockService(_access, lockStore, new CollectionLockSettingsStore(_db), verifier, _tokens, TimeProvider.System);
        _items = new GetCollectionItemsService(_access, _collections, new FakeImageStorage());
        _addItem = new AddItemToCollectionService(_access, _collections, TimeProvider.System);
        _public = new PublicCollectionService(new PublicCollectionStore(_db), lockStore, verifier, _tokens, TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Shared", "SHARED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _ownerOtherId = (await _collections.CreateAsync(_owner, "Private", "PRIVATE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _contributorOwnId = (await _collections.CreateAsync(_contributor, "Mine", "MINE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;

        _ownerItemInShared = await NewItemAsync(_owner, "https://example.test/owner-shared", memo: "owner secret memo", withPhoto: true);
        _ownerItemElsewhere = await NewItemAsync(_owner, "https://example.test/owner-private", memo: "owner other memo");
        _contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor", memo: "contributor secret memo", withPhoto: true);
        _contributorOtherItem = await NewItemAsync(_contributor, "https://example.test/contributor-other", memo: null);

        await _addItem.AddAsync(_owner, _sharedId, _ownerItemInShared);
        await _addItem.AddAsync(_owner, _ownerOtherId, _ownerItemElsewhere);
        await _addItem.AddAsync(_contributor, _contributorOwnId, _contributorItem);

        await InviteAndAcceptAsync(_sharedId, _owner, _contributor);
        await _addItem.AddAsync(_contributor, _sharedId, _contributorItem);
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

    // ---------- membership & listing ----------

    [Fact]
    public async Task SharedTab_ListsCollectionsSharedWithMe_WithOwnerJupleId_AndFullItemCount()
    {
        var shared = await _collections.ListSharedAsync(_contributor, null, null, null, 50);
        var owned = await _collections.ListAsync(_contributor, null, null, null, null, 50);
        var ownerOwned = await _collections.ListAsync(_owner, null, null, null, null, 50);

        var row = Assert.Single(shared.Items);
        Assert.Equal(_sharedId, row.Id);
        Assert.Equal(CollectionDtoAccessRoles.Contributor, row.AccessRole);
        Assert.Equal(await JupleIdOfAsync(_owner), row.OwnerJupleId);
        Assert.False(row.IsFavorite);
        Assert.False(row.IsPublicShareActive); // Owner-only, like HasCollaborators
        Assert.Equal(2, row.ItemCount); // Owner's link + Contributor's link

        Assert.DoesNotContain(owned.Items, collection => collection.Id == _sharedId);
        Assert.Contains(owned.Items, collection => collection.Id == _contributorOwnId);
        Assert.True(ownerOwned.Items.Single(collection => collection.Id == _sharedId).HasCollaborators);

        // The Owner sees their own shared Collection under 공유 컬렉션 too (still under 내 컬렉션),
        // once, as the Owner - never their unshared ones.
        var ownerShared = Assert.Single((await _collections.ListSharedAsync(_owner, null, null, null, 50)).Items);
        Assert.Equal(_sharedId, ownerShared.Id);
        Assert.Equal(CollectionDtoAccessRoles.Owner, ownerShared.AccessRole);
        Assert.True(ownerShared.HasCollaborators);
        Assert.Equal(2, ownerShared.ItemCount);
        var ownerAll = (await _collections.ListByScopeAsync(_owner, CollectionListScope.All, null, null, null, 50)).Items;
        Assert.Single(ownerAll, collection => collection.Id == _sharedId);
    }

    [Fact]
    public async Task SharedTab_ListsMyOwnCollection_WhileItHasAnActiveEveryoneLink_Only()
    {
        Assert.DoesNotContain((await _collections.ListSharedAsync(_owner, null, null, null, 50)).Items, collection => collection.Id == _ownerOtherId);

        _db.CollectionShares.Add(new CollectionShare(_ownerOtherId, Guid.NewGuid().ToString("N"), DateTimeOffset.UtcNow));
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var publicRow = Assert.Single((await _collections.ListSharedAsync(_owner, null, null, null, 50)).Items, collection => collection.Id == _ownerOtherId);
        Assert.Equal(CollectionDtoAccessRoles.Owner, publicRow.AccessRole);
        // The card's shared marker reads the same fact the scope used: a public link with no members.
        Assert.True(publicRow.IsPublicShareActive);
        Assert.False(publicRow.HasCollaborators);
        Assert.True((await _collections.GetAsync(_owner, _ownerOtherId)).IsPublicShareActive);

        var share = await _db.CollectionShares.SingleAsync(entry => entry.CollectionId == _ownerOtherId && entry.IsActive);
        share.Revoke(DateTimeOffset.UtcNow);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        Assert.DoesNotContain((await _collections.ListSharedAsync(_owner, null, null, null, 50)).Items, collection => collection.Id == _ownerOtherId);
        var afterRevoke = Assert.Single((await _collections.ListAsync(_owner, null, null, null, null, 50)).Items, collection => collection.Id == _ownerOtherId);
        Assert.False(afterRevoke.IsPublicShareActive);
    }

    [Fact]
    public async Task Detail_IsVisibleToOwnerAndContributor_AndA404ForEveryoneElse()
    {
        Assert.Equal(CollectionDtoAccessRoles.Owner, (await _collections.GetAsync(_owner, _sharedId)).AccessRole);
        Assert.Equal(CollectionDtoAccessRoles.Contributor, (await _collections.GetAsync(_contributor, _sharedId)).AccessRole);

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_stranger, _sharedId));
        // Being a Contributor of one Collection says nothing about the Owner's others.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_contributor, _ownerOtherId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_contributor, _ownerOtherId, null, 50));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_stranger, _sharedId, null, 50));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_contributor, long.MaxValue - 7, null, 50));
    }

    // ---------- privacy of other members' Items ----------

    [Fact]
    public async Task Members_SeeEveryLink_ButNeverAnotherMembersMemoOrUploadedPhotos()
    {
        var contributorView = (await _items.GetAsync(_contributor, _sharedId, null, 50)).Items;
        var ownerView = (await _items.GetAsync(_owner, _sharedId, null, 50)).Items;

        Assert.Equal(2, contributorView.Count);
        Assert.Equal(2, ownerView.Count);

        var ownersItemSeenByContributor = contributorView.Single(item => item.ItemId == _ownerItemInShared);
        Assert.False(ownersItemSeenByContributor.IsMine);
        Assert.Null(ownersItemSeenByContributor.Memo);
        Assert.Null(ownersItemSeenByContributor.RepresentativeImage);
        Assert.Null(ownersItemSeenByContributor.CoverImage);
        Assert.Equal("https://img.example.test/preview.jpg", ownersItemSeenByContributor.PreviewImageUrl);

        var contributorsItemSeenByOwner = ownerView.Single(item => item.ItemId == _contributorItem);
        Assert.False(contributorsItemSeenByOwner.IsMine);
        Assert.Null(contributorsItemSeenByOwner.Memo);
        Assert.Null(contributorsItemSeenByOwner.RepresentativeImage);

        var ownItem = contributorView.Single(item => item.ItemId == _contributorItem);
        Assert.True(ownItem.IsMine);
        Assert.Equal("contributor secret memo", ownItem.Memo);
        Assert.NotNull(ownItem.RepresentativeImage);

        // Store level: the other member's blob name is never even selected.
        var (_, representative, cover) = await _collections.GetItemsAsync(_owner, _sharedId, null, 50);
        Assert.False(representative.ContainsKey(_contributorItem));
        Assert.False(cover.ContainsKey(_contributorItem));
    }

    [Fact]
    public async Task EachLink_SaysWhoAddedIt_AsTheViewerMaySeeThem()
    {
        var ownerJupleId = await JupleIdOfAsync(_owner);
        var contributorJupleId = await JupleIdOfAsync(_contributor);

        // Each person with their own public identity (and the Owner flagged - for the crown); no
        // profile photos here (none set, and no photo storage in this fixture).
        var ownerView = (await _items.GetAsync(_owner, _sharedId, null, 50)).Items;
        Assert.Equal(
            new CollectionItemAdderDto(CollectionItemAdderKinds.Me, ownerJupleId, null, IsCollectionOwner: true),
            ownerView.Single(item => item.ItemId == _ownerItemInShared).AddedBy);
        Assert.Equal(
            new CollectionItemAdderDto(CollectionItemAdderKinds.Member, contributorJupleId, null),
            ownerView.Single(item => item.ItemId == _contributorItem).AddedBy);

        var contributorView = (await _items.GetAsync(_contributor, _sharedId, null, 50)).Items;
        Assert.Equal(
            new CollectionItemAdderDto(CollectionItemAdderKinds.Owner, ownerJupleId, null, IsCollectionOwner: true),
            contributorView.Single(item => item.ItemId == _ownerItemInShared).AddedBy);
        Assert.Equal(
            new CollectionItemAdderDto(CollectionItemAdderKinds.Me, contributorJupleId, null),
            contributorView.Single(item => item.ItemId == _contributorItem).AddedBy);

        // The read-only single-link view carries the same answer.
        Assert.Equal(CollectionItemAdderKinds.Owner, (await _items.GetItemAsync(_contributor, _sharedId, _ownerItemInShared))!.AddedBy!.Kind);
    }

    [Fact]
    public async Task IconPhoto_OnlyTheOwnerSetsIt_EveryoneWhoSeesTheCollectionGetsItsUrl()
    {
        var store = new CollectionStore(_db, new FakeIconStorage());
        var first = $"items/{_owner}/collections/{_sharedId}/first.jpg";
        var second = $"items/{_owner}/collections/{_sharedId}/second.jpg";

        var (set, replaced) = await store.SetIconImageAsync(_owner, _sharedId, first, DateTimeOffset.UtcNow);
        Assert.Null(replaced);
        Assert.Equal($"https://blob.example.test/{first}", set.IconImageUrl);
        // The photo's own version: stable for the same photo on every response, never the Blob name.
        Assert.NotNull(set.IconImageVersion);
        Assert.DoesNotContain("first", set.IconImageVersion);
        _db.ChangeTracker.Clear();

        // A member sees the Owner's photo on both the detail and the list; the built-in icon stays.
        var memberView = await store.GetAsync(_contributor, _sharedId);
        Assert.Equal($"https://blob.example.test/{first}", memberView.IconImageUrl);
        Assert.Equal(set.IconImageVersion, memberView.IconImageVersion);
        var listed = Assert.Single((await store.ListSharedAsync(_contributor, null, null, null, 50)).Items);
        Assert.Equal($"https://blob.example.test/{first}", listed.IconImageUrl);
        Assert.Equal(set.IconImageVersion, listed.IconImageVersion);
        Assert.Equal("Folder", listed.Icon);
        var withoutPhoto = await store.GetAsync(_owner, _ownerOtherId);
        Assert.Null(withoutPhoto.IconImageUrl);
        Assert.Null(withoutPhoto.IconImageVersion);

        // Never a member's (or a stranger's) to change.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.SetIconImageAsync(_contributor, _sharedId, second, DateTimeOffset.UtcNow));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => store.SetIconImageAsync(_stranger, _sharedId, null, DateTimeOffset.UtcNow));
        _db.ChangeTracker.Clear();

        // Replacing hands back the old Blob for deletion; clearing returns to the built-in icon.
        var (replacedView, replacedBlob) = await store.SetIconImageAsync(_owner, _sharedId, second, DateTimeOffset.UtcNow);
        Assert.Equal(first, replacedBlob);
        Assert.NotNull(replacedView.IconImageVersion);
        Assert.NotEqual(set.IconImageVersion, replacedView.IconImageVersion);
        _db.ChangeTracker.Clear();
        var (cleared, clearedBlob) = await store.SetIconImageAsync(_owner, _sharedId, null, DateTimeOffset.UtcNow);
        Assert.Equal(second, clearedBlob);
        Assert.Null(cleared.IconImageUrl);
        Assert.Null(cleared.IconImageVersion);

        // A store without photo storage (and every older response) simply has no URL.
        _db.ChangeTracker.Clear();
        await store.SetIconImageAsync(_owner, _sharedId, first, DateTimeOffset.UtcNow);
        var unsigned = await _collections.GetAsync(_owner, _sharedId);
        Assert.Null(unsigned.IconImageUrl);
        Assert.Null(unsigned.IconImageVersion);
    }

    [Fact]
    public async Task SharedItemView_IsReadOnlyMetadata_AndOnlyForItemsOfThatCollection()
    {
        var item = await _items.GetItemAsync(_contributor, _sharedId, _ownerItemInShared);
        Assert.NotNull(item);
        Assert.False(item.IsMine);
        Assert.Equal("https://example.test/owner-shared", item.Url);

        // An Item of the Owner that is not in this Collection is not reachable through it.
        Assert.Null(await _items.GetItemAsync(_contributor, _sharedId, _ownerItemElsewhere));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetItemAsync(_stranger, _sharedId, _ownerItemInShared));
    }

    // ---------- adding / removing ----------

    [Fact]
    public async Task Contributor_AddsOnlyTheirOwnItems_RecordedAsAddedBy()
    {
        await _addItem.AddAsync(_contributor, _sharedId, _contributorOtherItem);
        var membership = await _db.CollectionItems.AsNoTracking()
            .SingleAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _contributorOtherItem);
        Assert.Equal(_contributor, membership.AddedByUserId);

        await Assert.ThrowsAsync<ItemNotFoundException>(() => _addItem.AddAsync(_contributor, _sharedId, _ownerItemElsewhere));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _addItem.AddAsync(_stranger, _sharedId, _contributorOtherItem));
        Assert.Equal(_owner, (await _db.CollectionItems.AsNoTracking()
            .SingleAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _ownerItemInShared)).AddedByUserId);
    }

    [Fact]
    public async Task Contributor_IsForbiddenFromEveryOwnerOnlyPermission_AndStoresStillFailClosed()
    {
        foreach (var permission in new[]
                 {
                     CollectionPermission.Edit, CollectionPermission.Delete, CollectionPermission.RemoveItem,
                     CollectionPermission.ManageCollaborators, CollectionPermission.ManageLock,
                     CollectionPermission.ManageShare, CollectionPermission.Reorganize,
                 })
        {
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => _access.RequireAsync(_contributor, _sharedId, permission));
        }

        // A favorite is the Contributor's own personal mark - allowed, and it changes nothing else.
        await _access.RequireAsync(_contributor, _sharedId, CollectionPermission.Favorite);

        var strangerId = await JupleIdOfAsync(_stranger);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _collaboration.InviteAsync(_contributor, _sharedId, strangerId));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _locks.LockAsync(_contributor, _sharedId));

        // Even if an Owner-only endpoint lost its permission attribute, the stores stay owner-only.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            _collections.RenameAsync(_contributor, _sharedId, "Hijacked", "HIJACKED", DateTimeOffset.UtcNow));
        await _collections.RemoveAsync(_contributor, _sharedId, _ownerItemInShared);
        await _collections.DeleteAsync(_contributor, _sharedId); // idempotent DELETE: a no-op for a non-owner
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _ownerItemInShared));
        Assert.Null((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).DeletedAtUtc);
    }

    [Fact]
    public async Task RemovingAContributor_KeepsTheLinksTheyAdded_AsTheCollectionsContent_AndEndsTheirAccessImmediately()
    {
        var contributorId = await JupleIdOfAsync(_contributor);
        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, contributorId.ToLowerInvariant());

        // Membership lifecycle != content lifecycle: their link stays in the shared Collection.
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _contributorItem));
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _contributorOwnId && entry.ItemId == _contributorItem));
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == _ownerItemInShared));
        Assert.True(await _db.Items.AnyAsync(item => item.Id == _contributorItem && item.DeletedAtUtc == null));

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_contributor, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_contributor, _sharedId, null, 50));
        Assert.Empty((await _collections.ListSharedAsync(_contributor, null, null, null, 50)).Items);
        await Assert.ThrowsAsync<CollectionCollaboratorNotFoundException>(() =>
            _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, contributorId));
    }

    [Fact]
    public async Task ContributorTrashingOrDeletingTheirOwnItem_RemovesItFromTheSharedCollection()
    {
        await _itemStore.DeleteAsync(_contributor, _contributorItem, DateTimeOffset.UtcNow);
        Assert.DoesNotContain((await _items.GetAsync(_owner, _sharedId, null, 50)).Items, item => item.ItemId == _contributorItem);
        Assert.Equal(1, (await _collections.GetAsync(_owner, _sharedId)).ItemCount);

        await _itemStore.PermanentDeleteAsync(_contributor, _contributorItem);
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.ItemId == _contributorItem));
    }

    // ---------- invitations ----------

    [Fact]
    public async Task Invitations_EnforceSelfDuplicateMemberAndAddresseeRules()
    {
        var stranger = await JupleIdOfAsync(_stranger);
        var ownerJupleId = await JupleIdOfAsync(_owner);
        var contributorJupleId = await JupleIdOfAsync(_contributor);

        await Assert.ThrowsAsync<InvalidCollectionException>(() => _collaboration.InviteAsync(_owner, _sharedId, ownerJupleId));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => _collaboration.InviteAsync(_owner, _sharedId, "ZZZZZZZZ"));
        var existing = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, contributorJupleId));
        Assert.Equal(CollectionCollaborationConflictException.AlreadyCollaborator, existing.Code);

        // Case/separator-insensitive exact match.
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, stranger[..4].ToLowerInvariant() + "-" + stranger[4..]);
        var duplicate = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collaboration.InviteAsync(_owner, _sharedId, stranger));
        Assert.Equal(CollectionCollaborationConflictException.InvitationPending, duplicate.Code);

        // Only the addressee can see or answer it - a forwarded id is worthless to anyone else.
        await Assert.ThrowsAsync<CollectionInvitationNotFoundException>(() => _collaboration.AcceptInvitationAsync(_contributor, invitation.InvitationId));
        await Assert.ThrowsAsync<CollectionInvitationNotFoundException>(() => _collaboration.AcceptInvitationAsync(_owner, invitation.InvitationId));
        Assert.Empty(await _collaboration.ListReceivedInvitationsAsync(_contributor));
        var received = Assert.Single(await _collaboration.ListReceivedInvitationsAsync(_stranger));
        Assert.Equal(ownerJupleId, received.OwnerJupleId);

        await _collaboration.AcceptInvitationAsync(_stranger, invitation.InvitationId);
        await _collaboration.AcceptInvitationAsync(_stranger, invitation.InvitationId); // idempotent replay
        Assert.Equal(1, await _db.CollectionCollaborators.CountAsync(entry => entry.CollectionId == _sharedId && entry.UserId == _stranger));
    }

    [Fact]
    public async Task Invitations_DeclineRevokeAndExpiry()
    {
        var stranger = await JupleIdOfAsync(_stranger);

        var declined = await _collaboration.InviteAsync(_owner, _ownerOtherId, stranger);
        await _collaboration.DeclineInvitationAsync(_stranger, declined.InvitationId);
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collaboration.AcceptInvitationAsync(_stranger, declined.InvitationId));

        var revoked = await _collaboration.InviteAsync(_owner, _ownerOtherId, stranger);
        await _collaboration.RevokeInvitationAsync(_owner, _ownerOtherId, revoked.InvitationId);
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collaboration.AcceptInvitationAsync(_stranger, revoked.InvitationId));

        var expiring = await _collaboration.InviteAsync(_owner, _ownerOtherId, stranger);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"UPDATE collections.CollectionInvitations SET ExpiresAtUtc = {DateTimeOffset.UtcNow.AddMinutes(-1)} WHERE Id = {expiring.InvitationId}");
        _db.ChangeTracker.Clear(); // a new request sees the database, not this context's earlier copy
        Assert.Empty(await _collaboration.ListReceivedInvitationsAsync(_stranger));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collaboration.AcceptInvitationAsync(_stranger, expiring.InvitationId));
        Assert.Equal(CollectionInvitationStatus.Expired,
            (await _db.CollectionInvitations.AsNoTracking().SingleAsync(entry => entry.Id == expiring.InvitationId)).Status);

        // The Owner can invite again once the old one expired.
        var again = await _collaboration.InviteAsync(_owner, _ownerOtherId, stranger);
        await _collaboration.AcceptInvitationAsync(_stranger, again.InvitationId);
        Assert.Equal(CollectionDtoAccessRoles.Contributor, (await _collections.GetAsync(_stranger, _ownerOtherId)).AccessRole);
    }

    [Fact]
    public async Task JupleIdLookup_IsExactOnly_AndRevealsNothingButTheId()
    {
        var code = await JupleIdOfAsync(_stranger);

        var found = await _collaboration.LookupAsync(_owner, code.ToLowerInvariant());
        Assert.Equal(new JupleIdLookupResult(code, IsSelf: false), found);
        Assert.True((await _collaboration.LookupAsync(_owner, await JupleIdOfAsync(_owner))).IsSelf);

        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => _collaboration.LookupAsync(_owner, code[..7]));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => _collaboration.LookupAsync(_owner, code + "2"));
        await Assert.ThrowsAsync<JupleIdNotFoundException>(() => _collaboration.LookupAsync(_owner, "%%%%%%%%"));
    }

    [Fact]
    public async Task JupleId_IsUniqueInTheDatabase()
    {
        var existing = await JupleIdOfAsync(_owner);
        var duplicate = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(duplicate);
        _db.Entry(duplicate).Property(user => user.PublicCode).CurrentValue = existing;

        await Assert.ThrowsAsync<DbUpdateException>(() => _db.SaveChangesAsync());
        _db.ChangeTracker.Clear();
    }

    // ---------- public share vs collaboration, reorganize guard ----------

    [Fact]
    public async Task PublicShare_PermissionIsTheMinimum_IncludingPendingInvitations()
    {
        // _sharedId has a Contributor member: 보기만 for everyone is allowed (a member may have more),
        // and so is raising it to 링크 추가.
        Assert.NotNull(await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow));
        Assert.NotNull(await _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write, DateTimeOffset.UtcNow));

        // A pending Viewer invitation counts too: it blocks 링크 추가 for everyone, never 보기만.
        var pendingOnly = (await _collections.CreateAsync(_owner, "Pending", "PENDING", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _collaboration.InviteAsync(_owner, pendingOnly, await JupleIdOfAsync(_stranger), CollectionCollaboratorRole.Viewer);
        var writeConflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _shares.EnableAsync(_owner, pendingOnly, NewPublicId(), DateTimeOffset.UtcNow, CollectionSharePermission.Write));
        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, writeConflict.Code);
        Assert.NotNull(await _shares.EnableAsync(_owner, pendingOnly, NewPublicId(), DateTimeOffset.UtcNow));

        // While 보기만 is on, either role can be invited; while 링크 추가 is on, never a Viewer.
        var publicOne = (await _collections.CreateAsync(_owner, "Public", "PUBLIC", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _shares.EnableAsync(_owner, publicOne, NewPublicId(), DateTimeOffset.UtcNow);
        var strangerJupleId = await JupleIdOfAsync(_stranger);
        var invited = await _collaboration.InviteAsync(_owner, publicOne, strangerJupleId);
        await _collaboration.RevokeInvitationAsync(_owner, publicOne, invited.InvitationId);
        await _shares.SetPermissionAsync(_owner, publicOne, CollectionSharePermission.Write, DateTimeOffset.UtcNow);
        var conflictWithShare = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, publicOne, strangerJupleId, CollectionCollaboratorRole.Viewer));
        Assert.Equal(CollectionCollaborationConflictException.PublicShareActive, conflictWithShare.Code);
        Assert.NotNull(await _collaboration.InviteAsync(_owner, publicOne, strangerJupleId));
    }

    [Fact]
    public async Task MergeAndTransfer_AreBlockedForCollaborativeCollections()
    {
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collections.MergeAsync(_owner, _sharedId, _ownerOtherId));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => _collections.MergeAsync(_owner, _ownerOtherId, _sharedId));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collections.TransferItemAsync(_owner, _ownerOtherId, _ownerItemElsewhere, _sharedId));
    }

    // ---------- lock ----------

    [Fact]
    public async Task Lock_GatesContentForOwnerAndContributorAlike_AndPasswordNeverReplacesAccess()
    {
        await LockAsync(_sharedId, "correct horse");
        // The Collection stores no password of its own; the Owner's one lock password is stored one-way only.
        Assert.Null((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).LockPasswordHash);
        var hash = (await _db.UserCollectionLockSettings.AsNoTracking().SingleAsync(entry => entry.UserId == _owner)).PasswordHash;
        Assert.DoesNotContain("correct horse", hash);

        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, _sharedId, null, 50));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_contributor, _sharedId, null, 50));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_contributor, _sharedId, "wrong horse"));

        var contributorGrant = await _locks.UnlockAsync(_contributor, _sharedId, "correct horse");
        Assert.Equal(2, (await _items.GetAsync(_contributor, _sharedId, null, 50, contributorGrant.Token)).Items.Count);
        // A grant is bound to its user: it opens nothing for the Owner.
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, _sharedId, null, 50, contributorGrant.Token));
        // Knowing the password without access is still a plain 404.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _locks.UnlockAsync(_stranger, _sharedId, "correct horse"));

        // Changing the Owner's lock password needs the current one, and invalidates every outstanding grant.
        var lockPasswords = new CollectionLockPasswordService(
            new CollectionLockSettingsStore(_db), new CollectionLockPasswordHasher(), TimeProvider.System);
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() =>
            lockPasswords.ChangeAsync(_owner, "nope nope", "battery staple", "battery staple"));
        await lockPasswords.ChangeAsync(_owner, "correct horse", "battery staple", "battery staple");
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_contributor, _sharedId, null, 50, contributorGrant.Token));

        var ownerGrant = await _locks.UnlockAsync(_owner, _sharedId, "battery staple");
        await _locks.RemoveAsync(_owner, _sharedId, "battery staple");
        Assert.False((await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).IsLocked);
        Assert.Equal(2, (await _items.GetAsync(_contributor, _sharedId, null, 50)).Items.Count);
        Assert.False(_tokens.IsValid(ownerGrant.Token, _sharedId, CollectionUnlockSubject.ForUser(_owner),
            (await _db.Collections.AsNoTracking().SingleAsync(entry => entry.Id == _sharedId)).LockVersion, DateTimeOffset.UtcNow));
    }

    [Fact]
    public async Task LockedCollection_ContentChangesNeedAGrant_ForOwnerAndContributor()
    {
        await LockAsync(_sharedId, "correct horse");
        var move = new Juple.Application.Collections.MoveCollectionItem.MoveCollectionItemService(_access, _collections);
        var remove = new Juple.Application.Collections.RemoveItemFromCollection.RemoveItemFromCollectionService(_access, _collections);

        await Assert.ThrowsAsync<CollectionLockedException>(() => _addItem.AddAsync(_contributor, _sharedId, _contributorOtherItem));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _addItem.AddAsync(_owner, _sharedId, _ownerItemElsewhere));
        await Assert.ThrowsAsync<CollectionLockedException>(() => move.MoveAsync(_owner, _sharedId, _ownerItemInShared, null));
        await Assert.ThrowsAsync<CollectionLockedException>(() => remove.RemoveAsync(_owner, _sharedId, _contributorItem));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _addItem.AddAsync(_stranger, _sharedId, _contributorOtherItem));
        Assert.Equal(2, await _db.CollectionItems.CountAsync(entry => entry.CollectionId == _sharedId));

        var contributorGrant = await _locks.UnlockAsync(_contributor, _sharedId, "correct horse");
        var ownerGrant = await _locks.UnlockAsync(_owner, _sharedId, "correct horse");
        await _addItem.AddAsync(_contributor, _sharedId, _contributorOtherItem, contributorGrant.Token);
        await _addItem.AddAsync(_owner, _sharedId, _ownerItemElsewhere, ownerGrant.Token);
        await move.MoveAsync(_owner, _sharedId, _ownerItemInShared, null, ownerGrant.Token);
        await remove.RemoveAsync(_owner, _sharedId, _contributorItem, ownerGrant.Token);

        Assert.Equal(3, await _db.CollectionItems.CountAsync(entry => entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task Unlock_IsThrottledPerUser_AcrossRequests_ViaThePersistedCounter()
    {
        await LockAsync(_sharedId, "correct horse");
        for (var attempt = 0; attempt < CollectionUnlockThrottle.MaxFailures; attempt++)
        {
            await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_contributor, _sharedId, "guess " + attempt));
        }

        await Assert.ThrowsAsync<CollectionUnlockThrottledException>(() => _locks.UnlockAsync(_contributor, _sharedId, "correct horse"));
        // The counter is per subject - the Owner is not locked out by someone else's guesses.
        Assert.NotNull(await _locks.UnlockAsync(_owner, _sharedId, "correct horse"));
    }

    [Fact]
    public async Task LockedPublicShare_RevealsNothingUntilUnlocked_AndOnlyTheOwnersItemsWithPreviewImages()
    {
        var publicCollection = (await _collections.CreateAsync(_owner, "Public locked", "PUBLIC LOCKED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _addItem.AddAsync(_owner, publicCollection, _ownerItemInShared);
        var publicId = NewPublicId();
        await _shares.EnableAsync(_owner, publicCollection, publicId, DateTimeOffset.UtcNow);
        await LockAsync(publicCollection, "web secret 1");

        // Defense in depth: a foreign Item that somehow sits in a public Collection is never published.
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionItems (CollectionId, ItemId, AddedByUserId, AddedAtUtc, SortOrder) VALUES ({publicCollection}, {_contributorOtherItem}, {_contributor}, {DateTimeOffset.UtcNow}, 99999)");

        Assert.Equal(new PublicCollectionDto(null, true), await _public.GetCollectionAsync(publicId));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _public.GetItemsAsync(publicId, null, 50));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _public.UnlockAsync(publicId, "not it at all"));

        var grant = await _public.UnlockAsync(publicId, "web secret 1");
        Assert.Equal("Public locked", (await _public.GetCollectionAsync(publicId, grant!.Token))!.Name);
        var item = Assert.Single((await _public.GetItemsAsync(publicId, null, 50, grant.Token))!.Items);
        Assert.Equal("https://example.test/owner-shared", item.Url);
        Assert.Equal("https://img.example.test/preview.jpg", item.PreviewImageUrl);

        // The public grant is bound to the share: it opens nothing in-app.
        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_owner, publicCollection, null, 50, grant.Token));
    }

    // ---------- account deletion ----------

    [Fact]
    public async Task AccountDeletion_ClearsEveryCollaborationReference_WithoutFkBlockers()
    {
        await _collaboration.InviteAsync(_owner, _ownerOtherId, await JupleIdOfAsync(_stranger));
        await LockAsync(_sharedId, "correct horse");
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_contributor, _sharedId, "wrong horse"));

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_contributor, $"test/{_contributor}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_contributor);

        Assert.False(await _db.CollectionCollaborators.AnyAsync(entry => entry.UserId == _contributor));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.AddedByUserId == _contributor));
        Assert.False(await _db.CollectionUnlockThrottles.AnyAsync(entry => entry.SubjectKey == $"u:{_contributor}"));
        Assert.Equal(1, (await _collections.GetAsync(_owner, _sharedId)).ItemCount);

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_owner, $"test/{_owner}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_owner);
        Assert.False(await _db.CollectionInvitations.AnyAsync(entry => entry.InvitedByUserId == _owner));
        Assert.False(await _db.Collections.AnyAsync(entry => entry.UserId == _owner));
    }

    // ---------- helpers ----------

    /// <summary>Sets the Owner's one lock password (as right after a real sign-in) and locks the Collection under it.</summary>
    /// <summary>
    /// Locks it under the Owner's lock password as a Collection locked before share passwords existed
    /// (the migration's legacy mode): these tests cover the lock gating its recipients too, as it
    /// did then. A Collection locked today gates only its Owner - see CollectionSharePasswordIntegrationTests.
    /// </summary>
    private async Task LockAsync(long collectionId, string password)
    {
        await new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), new CollectionLockPasswordHasher(), TimeProvider.System)
            .ResetAsync(_owner, password, password, DateTimeOffset.UtcNow);
        await _locks.LockAsync(_owner, collectionId);
        await _db.Database.ExecuteSqlInterpolatedAsync(
            $"INSERT INTO collections.CollectionSharePasswords (CollectionId, Mode, PasswordVersion, CreatedAtUtc, UpdatedAtUtc) VALUES ({collectionId}, 'LegacyCommonLock', 1, {DateTimeOffset.UtcNow}, {DateTimeOffset.UtcNow})");
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url, string? memo, bool withPhoto = false)
    {
        var saved = await _itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        var item = await _db.Items.SingleAsync(entry => entry.Id == saved.Entry.Id);
        item.UpdateDetails("Title of " + url, memo);
        item.SetPreviewImageUrl("https://img.example.test/preview.jpg");
        if (withPhoto)
        {
            var image = new ItemImage(item.Id, $"users/{userId}/items/{item.Id}/photo.jpg", "image/jpeg", 10, 0, DateTimeOffset.UtcNow);
            _db.ItemImages.Add(image);
            await _db.SaveChangesAsync();
            item.SetCoverImageId(image.Id);
        }

        await _db.SaveChangesAsync();
        return item.Id;
    }

    private async Task InviteAndAcceptAsync(long collectionId, long ownerId, long inviteeId)
    {
        var invitation = await _collaboration.InviteAsync(ownerId, collectionId, await JupleIdOfAsync(inviteeId));
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private static string NewPublicId() => Guid.NewGuid().ToString("N");

    private sealed class FakeIconStorage : ICollectionIconImageStorage
    {
        public Task<string> UploadCollectionIconAsync(long ownerUserId, long collectionId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteCollectionIconAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<Uri?> CreateCollectionIconReadUrlAsync(long ownerUserId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }

    private sealed class FakeImageStorage : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }
}
