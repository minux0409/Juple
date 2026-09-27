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
using Juple.Application.Collections.SetCollectionFavorite;
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
/// 보기 전용 공유 (Viewer) against a real SQL Server schema: a Viewer sees the Collection and its
/// links and keeps their own favorite mark, and nothing else - no adding, removing, reordering,
/// editing or managing - while the Contributor rules stay exactly as they were. A Viewer (or a
/// pending Viewer invitation) coexists with the public link; a Contributor still does not.
/// </summary>
public sealed class CollectionViewerIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _viewer;
    private long _stranger;
    private long _sharedId;
    private long _ownerItem;
    private long _viewerItem;

    private CollectionStore _collections = null!;
    private CollectionAccessService _access = null!;
    private CollectionCollaborationService _collaboration = null!;
    private CollectionLockService _locks = null!;
    private GetCollectionItemsService _items = null!;
    private AddItemToCollectionService _addItem = null!;
    private SetCollectionFavoriteService _favorites = null!;
    private CollectionShareStore _shares = null!;
    private ItemStore _itemStore = null!;

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _viewer = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db);
        _itemStore = new ItemStore(_db);
        _shares = new CollectionShareStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var lockStore = new CollectionLockStore(_db);
        var hasher = new CollectionLockPasswordHasher();
        _access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            _access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        _locks = new CollectionLockService(_access, lockStore, new CollectionLockSettingsStore(_db), new CollectionPasswordVerifier(lockStore, hasher), tokens, TimeProvider.System);
        _items = new GetCollectionItemsService(_access, _collections, new FakeImageStorage());
        _addItem = new AddItemToCollectionService(_access, _collections, TimeProvider.System);
        _favorites = new SetCollectionFavoriteService(_access, _collections, TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _ownerItem = await NewItemAsync(_owner, "https://example.test/owner");
        _viewerItem = await NewItemAsync(_viewer, "https://example.test/viewer");
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

    [Fact]
    public async Task ViewerInvitation_IsLabelledAsViewer_AndOnAcceptTheCollectionIsSharedAsViewer()
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_viewer), CollectionCollaboratorRole.Viewer);
        Assert.Equal("Viewer", invitation.Role);

        var received = Assert.Single(await _collaboration.ListReceivedInvitationsAsync(_viewer));
        Assert.Equal("Viewer", received.Role);
        Assert.Equal(_sharedId, received.CollectionId);

        // Being invited grants nothing until accepted.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_viewer, _sharedId));

        await _collaboration.AcceptInvitationAsync(_viewer, invitation.InvitationId);

        var shared = Assert.Single((await _collections.ListSharedAsync(_viewer, null, null, null, 50)).Items);
        Assert.Equal(_sharedId, shared.Id);
        Assert.Equal(CollectionDtoAccessRoles.Viewer, shared.AccessRole);
        Assert.Equal(await JupleIdOfAsync(_owner), shared.OwnerJupleId);
        Assert.Contains((await _collections.ListByScopeAsync(_viewer, CollectionListScope.All, null, null, null, 50)).Items,
            collection => collection.Id == _sharedId && collection.AccessRole == CollectionDtoAccessRoles.Viewer);

        // The Owner sees them as a member (the shared marker) with the viewer role everywhere.
        Assert.True((await _collections.GetAsync(_owner, _sharedId)).HasCollaborators);
        var participants = await _collaboration.GetParticipantsAsync(_owner, _sharedId);
        Assert.Equal(
            [CollectionDtoAccessRoles.Owner, CollectionDtoAccessRoles.Viewer],
            participants.Participants.Select(participant => participant.Role));
        var ownerCard = await _collections.GetAsync(_owner, _sharedId);
        Assert.Equal(CollectionDtoAccessRoles.Viewer, Assert.Single(ownerCard.ParticipantPreview!).Role);

        var access = await _access.RequireAsync(_viewer, _sharedId, CollectionPermission.View);
        Assert.Equal(CollectionAccessRole.Viewer, access.Role);
    }

    [Fact]
    public async Task Viewer_SeesTheLinksAndReadOnlyDetail_AndKeepsTheirOwnFavorite()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);

        var page = await _items.GetAsync(_viewer, _sharedId, null, 50);
        var entry = Assert.Single(page.Items);
        Assert.Equal(_ownerItem, entry.ItemId);
        Assert.False(entry.IsMine);
        var detail = await _items.GetItemAsync(_viewer, _sharedId, _ownerItem);
        Assert.NotNull(detail);

        var favorited = await _favorites.SetFavoriteAsync(_viewer, _sharedId, new SetCollectionFavoriteCommand(true));
        Assert.True(favorited.IsFavorite);
        // Their mark only - the Owner's own favorite state is untouched.
        Assert.False((await _collections.GetAsync(_owner, _sharedId)).IsFavorite);
        Assert.Contains((await _collections.ListByScopeAsync(_viewer, CollectionListScope.Favorites, null, null, null, 50)).Items,
            collection => collection.Id == _sharedId);
    }

    [Fact]
    public async Task Viewer_CannotAddRemoveReorderEditDeleteShareOrManage_AndStoresFailClosed()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);

        foreach (var permission in new[]
                 {
                     CollectionPermission.AddItem, CollectionPermission.Edit, CollectionPermission.Delete,
                     CollectionPermission.RemoveItem, CollectionPermission.ManageCollaborators,
                     CollectionPermission.ManageLock, CollectionPermission.ManageShare, CollectionPermission.Reorganize,
                 })
        {
            await Assert.ThrowsAsync<CollectionForbiddenException>(() => _access.RequireAsync(_viewer, _sharedId, permission));
        }

        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(_viewer, _sharedId, _viewerItem));
        // Even without the service-level check, the store refuses a Viewer's add.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            _collections.AddAsync(_viewer, _sharedId, _viewerItem, DateTimeOffset.UtcNow));
        Assert.False(await _db.CollectionItems.AnyAsync(membership => membership.CollectionId == _sharedId && membership.ItemId == _viewerItem));

        var strangerJupleId = await JupleIdOfAsync(_stranger);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() =>
            _collaboration.InviteAsync(_viewer, _sharedId, strangerJupleId, CollectionCollaboratorRole.Viewer));
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _locks.LockAsync(_viewer, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() =>
            _collections.RenameAsync(_viewer, _sharedId, "Hijacked", "HIJACKED", DateTimeOffset.UtcNow));
        await _collections.RemoveAsync(_viewer, _sharedId, _ownerItem);
        await _collections.DeleteAsync(_viewer, _sharedId);
        Assert.True(await _db.CollectionItems.AnyAsync(membership => membership.CollectionId == _sharedId && membership.ItemId == _ownerItem));
        Assert.True(await _db.Collections.AnyAsync(collection => collection.Id == _sharedId && collection.DeletedAtUtc == null));
    }

    [Fact]
    public async Task LockedCollection_ViewerMustUnlockToSeeContent_AndThePasswordGrantsNoMoreThanViewing()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await LockAsync(_sharedId, "correct horse");

        await Assert.ThrowsAsync<CollectionLockedException>(() => _items.GetAsync(_viewer, _sharedId, null, 50));
        await Assert.ThrowsAsync<InvalidCollectionPasswordException>(() => _locks.UnlockAsync(_viewer, _sharedId, "wrong horse"));

        var grant = await _locks.UnlockAsync(_viewer, _sharedId, "correct horse");
        Assert.Single((await _items.GetAsync(_viewer, _sharedId, null, 50, grant.Token)).Items);
        // A correct password never turns a Viewer into a Contributor.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _addItem.AddAsync(_viewer, _sharedId, _viewerItem, grant.Token));
    }

    [Fact]
    public async Task RemovingAViewer_EndsTheirAccess_AndClearsTheirFavorite()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await _favorites.SetFavoriteAsync(_viewer, _sharedId, new SetCollectionFavoriteCommand(true));
        _db.ChangeTracker.Clear();

        await _collaboration.RemoveCollaboratorAsync(_owner, _sharedId, await JupleIdOfAsync(_viewer));

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_viewer, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _items.GetAsync(_viewer, _sharedId, null, 50));
        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _viewer && favorite.CollectionId == _sharedId));
        Assert.Empty((await _collections.ListSharedAsync(_viewer, null, null, null, 50)).Items);
        // The Owner's links are untouched.
        Assert.Equal(1, (await _collections.GetAsync(_owner, _sharedId)).ItemCount);
    }

    [Fact]
    public async Task DeletingAViewersAccount_LeavesNoMembershipOrInvitationBehind()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await _favorites.SetFavoriteAsync(_viewer, _sharedId, new SetCollectionFavoriteCommand(true));
        var pendingElsewhere = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _collaboration.InviteAsync(_owner, pendingElsewhere, await JupleIdOfAsync(_viewer), CollectionCollaboratorRole.Viewer);
        _db.ChangeTracker.Clear();

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_viewer, $"test/{_viewer}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_viewer);

        Assert.False(await _db.CollectionCollaborators.AnyAsync(collaborator => collaborator.UserId == _viewer));
        Assert.False(await _db.CollectionInvitations.AnyAsync(invitation => invitation.InvitedUserId == _viewer));
        Assert.False(await _db.CollectionFavorites.AnyAsync(favorite => favorite.UserId == _viewer));
        Assert.Equal(1, (await _collections.GetAsync(_owner, _sharedId)).ItemCount);
    }

    [Fact]
    public async Task PublicLink_KeepsEverySpecificRoleEqualToItsPermission()
    {
        // A Viewer member, then 보기만 for everyone: allowed.
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow);

        // A pending Viewer invitation, then 보기만: allowed.
        var pendingViewer = (await _collections.CreateAsync(_owner, "PendingViewer", "PENDINGVIEWER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await _collaboration.InviteAsync(_owner, pendingViewer, await JupleIdOfAsync(_stranger), CollectionCollaboratorRole.Viewer);
        await _shares.EnableAsync(_owner, pendingViewer, NewPublicId(), DateTimeOffset.UtcNow);

        // While 보기만 is on, a Viewer may be invited and accept; a Contributor may not.
        var viewerInvite = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_stranger), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(_stranger, viewerInvite.InvitationId);
        var contributorAgain = await NewUserAsync();
        var blocked = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, _sharedId, JupleIdOf(contributorAgain), CollectionCollaboratorRole.Contributor));
        Assert.Equal(CollectionCollaborationConflictException.PublicShareActive, blocked.Code);

        // Switching the link to 링크 추가 while Viewers exist is refused - no one is changed automatically.
        var switchConflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write, DateTimeOffset.UtcNow));
        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, switchConflict.Code);
        Assert.All(await _db.CollectionCollaborators.AsNoTracking().Where(entry => entry.CollectionId == _sharedId).ToListAsync(),
            member => Assert.Equal(CollectionCollaboratorRole.Viewer, member.Role));

        // A pending Contributor blocks 보기만, but 링크 추가 is allowed - and then only Contributors join.
        var withContributor = (await _collections.CreateAsync(_owner, "Collab", "COLLAB", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var contributorInvite = await _collaboration.InviteAsync(_owner, withContributor, JupleIdOf(contributorAgain));
        var pendingConflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _shares.EnableAsync(_owner, withContributor, NewPublicId(), DateTimeOffset.UtcNow));
        Assert.Equal(CollectionCollaborationConflictException.PublicSharePermissionMismatch, pendingConflict.Code);
        await _shares.EnableAsync(_owner, withContributor, NewPublicId(), DateTimeOffset.UtcNow, CollectionSharePermission.Write);
        await _collaboration.AcceptInvitationAsync(contributorAgain, contributorInvite.InvitationId);
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.InviteAsync(_owner, withContributor, JupleIdOf(_viewer), CollectionCollaboratorRole.Viewer));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() =>
            _collaboration.ChangeCollaboratorRoleAsync(_owner, withContributor, JupleIdOf(contributorAgain), CollectionCollaboratorRole.Viewer));
    }

    [Fact]
    public async Task ADefaultInvitation_IsStillAContributor_WithTheExistingRights()
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_stranger));
        Assert.Equal("Contributor", invitation.Role);
        await _collaboration.AcceptInvitationAsync(_stranger, invitation.InvitationId);

        Assert.Equal(CollectionDtoAccessRoles.Contributor, Assert.Single((await _collections.ListSharedAsync(_stranger, null, null, null, 50)).Items).AccessRole);
        var strangerItem = await NewItemAsync(_stranger, "https://example.test/stranger");
        await _addItem.AddAsync(_stranger, _sharedId, strangerItem);
        Assert.True(await _db.CollectionItems.AnyAsync(membership => membership.CollectionId == _sharedId && membership.ItemId == strangerItem));
    }

    // ---------- helpers ----------

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    /// <summary>Sets the Owner's one lock password (as right after a real sign-in) and locks the Collection under it.</summary>
    private async Task LockAsync(long collectionId, string password)
    {
        await new CollectionLockPasswordService(new CollectionLockSettingsStore(_db), new CollectionLockPasswordHasher(), TimeProvider.System)
            .ResetAsync(_owner, password, password, DateTimeOffset.UtcNow);
        await _locks.LockAsync(_owner, collectionId);
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

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await _itemStore.SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private string JupleIdOf(long userId) =>
        _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).Single();

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
