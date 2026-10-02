using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.GetCollectionShare;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Collections.ShareLink;
using Juple.Application.Images;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Collections;

/// <summary>
/// What a signed-in member (not only the Owner) may read about a shared Collection, against a real
/// SQL Server schema: the participant list (accepted people only, management only for the Owner),
/// the active public link to pass on (on/off and its id - nothing else of the share settings), and
/// each link's adder with their profile photo and whether they are the Owner. A pending invitee or
/// a stranger is refused exactly like any other read.
/// </summary>
public sealed class CollectionMemberShareLinkAndAdderIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];

    private long _owner;
    private long _viewer;
    private long _contributor;
    private long _pending;
    private long _stranger;
    private long _sharedId;

    private CollectionStore _collections = null!;
    private CollectionShareStore _shares = null!;
    private CollectionCollaborationService _collaboration = null!;
    private GetCollectionShareLinkService _shareLink = null!;
    private AddItemToCollectionService _addItem = null!;
    private ItemStore _itemStore = null!;
    private readonly FakeProfileImageStorage _profileImages = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);

        _owner = await NewUserAsync();
        _viewer = await NewUserAsync();
        _contributor = await NewUserAsync();
        _pending = await NewUserAsync();
        _stranger = await NewUserAsync();

        _collections = new CollectionStore(_db, profileImageStorage: _profileImages);
        _shares = new CollectionShareStore(_db);
        _itemStore = new ItemStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collaboration = new CollectionCollaborationService(
            access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db, _profileImages), TimeProvider.System);
        _shareLink = new GetCollectionShareLinkService(access, _shares);
        _addItem = new AddItemToCollectionService(access, _collections, TimeProvider.System);

        _sharedId = (await _collections.CreateAsync(_owner, "Trip", "TRIP", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
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

    // ---------- participants ----------

    [Fact]
    public async Task Participants_OwnerViewerAndContributor_AllSeeTheAcceptedPeople_OnlyTheOwnerSeesPendingAndManages()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);
        _db.ChangeTracker.Clear();

        var asOwner = await _collaboration.GetParticipantsAsync(_owner, _sharedId);
        Assert.True(asOwner.CanManage);
        Assert.Single(asOwner.PendingInvitations);

        foreach (var member in new[] { _viewer, _contributor })
        {
            var view = await _collaboration.GetParticipantsAsync(member, _sharedId);
            Assert.False(view.CanManage);
            Assert.Empty(view.PendingInvitations);
            Assert.Equal(
                [CollectionDtoAccessRoles.Owner, CollectionDtoAccessRoles.Viewer, CollectionDtoAccessRoles.Contributor],
                view.Participants.Select(participant => participant.Role));
            // Pending people are never participants.
            Assert.DoesNotContain(view.Participants, participant => participant.JupleId == JupleIdOf(_pending));
            Assert.Single(view.Participants, participant => participant.IsMe);
        }
    }

    [Fact]
    public async Task Participants_PendingInviteeAndStranger_AreRefused()
    {
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Contributor);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collaboration.GetParticipantsAsync(_pending, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collaboration.GetParticipantsAsync(_stranger, _sharedId));
    }

    // ---------- public link for members ----------

    [Fact]
    public async Task ShareLink_IsNullForEveryoneWhileThePublicLinkIsOff()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);

        Assert.Null(await _shareLink.GetActivePublicIdAsync(_owner, _sharedId));
        Assert.Null(await _shareLink.GetActivePublicIdAsync(_viewer, _sharedId));
    }

    [Fact]
    public async Task ShareLink_OwnerAndViewer_GetTheActivePublicId_AndLoseItWhenTheOwnerTurnsItOff()
    {
        // The public link matches every member's role (see RequireEveryoneMatchesAsync): read-only with a Viewer.
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        var share = await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow, CollectionSharePermission.Read);
        _db.ChangeTracker.Clear();

        Assert.Equal(share.PublicId, await _shareLink.GetActivePublicIdAsync(_owner, _sharedId));
        Assert.Equal(share.PublicId, await _shareLink.GetActivePublicIdAsync(_viewer, _sharedId));

        // Members only read it: the Owner-only share management stays the Owner's.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _shares.GetActiveAsync(_viewer, _sharedId));

        await _shares.RevokeAsync(_owner, _sharedId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        Assert.Null(await _shareLink.GetActivePublicIdAsync(_viewer, _sharedId));
    }

    [Fact]
    public async Task ShareLink_Contributor_GetsTheActivePublicId()
    {
        // ...and one that lets people add with a Contributor.
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        var share = await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow, CollectionSharePermission.Write);
        _db.ChangeTracker.Clear();

        Assert.Equal(share.PublicId, await _shareLink.GetActivePublicIdAsync(_contributor, _sharedId));
    }

    [Fact]
    public async Task ShareLink_PendingInviteeAndStranger_AreRefused_EvenWhileTheLinkIsOn()
    {
        await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _shareLink.GetActivePublicIdAsync(_pending, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _shareLink.GetActivePublicIdAsync(_stranger, _sharedId));
    }

    // ---------- link adders ----------

    [Fact]
    public async Task Adders_CarryTheirProfilePhoto_AndWhetherTheyAreTheOwner_ForEveryMemberIncludingThemselves()
    {
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        await SetProfilePhotoAsync(_owner, "items/owner/profile/a.png");
        var ownerItem = await NewItemAsync(_owner, "https://example.test/owner");
        var secondOwnerItem = await NewItemAsync(_owner, "https://example.test/owner-2");
        var contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor");
        await _addItem.AddAsync(_owner, _sharedId, ownerItem);
        await _addItem.AddAsync(_owner, _sharedId, secondOwnerItem);
        await _addItem.AddAsync(_contributor, _sharedId, contributorItem);
        _db.ChangeTracker.Clear();

        var asContributor = await ItemsAsync(_contributor);
        // One signature per person per page - never one per link (two links by the Owner, one photo).
        Assert.Equal(1, _profileImages.SignCount);
        var byOwner = asContributor.Items.Single(item => item.ItemId == ownerItem).AddedBy!;
        Assert.Equal(CollectionItemAdderKinds.Owner, byOwner.Kind);
        Assert.True(byOwner.IsCollectionOwner);
        Assert.Equal(await JupleIdOfAsync(_owner), byOwner.JupleId);
        Assert.Equal("https://blob.example/items/owner/profile/a.png", byOwner.ProfileImageUrl);
        Assert.Equal(UserProfileImageVersion.From("items/owner/profile/a.png"), byOwner.ProfileImageVersion);

        var byMe = asContributor.Items.Single(item => item.ItemId == contributorItem).AddedBy!;
        Assert.Equal(CollectionItemAdderKinds.Me, byMe.Kind);
        Assert.False(byMe.IsCollectionOwner);
        Assert.Null(byMe.ProfileImageUrl); // no photo: the client shows its fallback avatar

        var asOwner = await ItemsAsync(_owner);
        var ownLink = asOwner.Items.Single(item => item.ItemId == ownerItem).AddedBy!;
        Assert.Equal(CollectionItemAdderKinds.Me, ownLink.Kind);
        Assert.True(ownLink.IsCollectionOwner);
        var byMember = asOwner.Items.Single(item => item.ItemId == contributorItem).AddedBy!;
        Assert.Equal(CollectionItemAdderKinds.Member, byMember.Kind);
        Assert.False(byMember.IsCollectionOwner);
    }

    // ---------- 친구에게 / ID로 공유 of the public link ----------

    private ShareCollectionLinkService SendLink() =>
        new(new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        })), TimeProvider.System), new UserDirectoryStore(_db), new CollectionLinkShareStore(_db), TimeProvider.System);

    [Fact]
    public async Task AMember_PassesThePublicLinkOn_AsANotificationOnly_NeverAMembershipOrAnInvitation()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);
        var share = await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        var result = await SendLink().ShareAsync(_viewer, _sharedId, [await JupleIdOfAsync(_stranger), await JupleIdOfAsync(_stranger), "ZZZZ2345"]);

        Assert.Equal([await JupleIdOfAsync(_stranger)], result.Sent);
        // Recorded in the outbox with the send; the recipient's notification is materialized asynchronously.
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        var notification = Assert.Single(await _db.Notifications.AsNoTracking()
            .Where(entry => entry.UserId == _stranger && entry.Type == NotificationType.CollectionLinkShared).ToListAsync());
        Assert.Equal(_sharedId, notification.CollectionId);
        Assert.Equal(_viewer, notification.ActorUserId);
        // Nothing about membership changed.
        Assert.False(await _db.CollectionCollaborators.AnyAsync(entry => entry.UserId == _stranger));
        Assert.False(await _db.CollectionInvitations.AnyAsync(entry => entry.InvitedUserId == _stranger));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _collections.GetAsync(_stranger, _sharedId));

        // Sent while the link is on: the push opens that public link.
        var context = (await new PushDispatchStore(_db).GetContextsAsync([notification], DateTimeOffset.UtcNow))[notification.Id];
        Assert.True(context.IsRelevant);
        Assert.Equal(share.PublicId, context.PublicShareId);

        // Turned off before the push went out: nothing is sent.
        await _shares.RevokeAsync(_owner, _sharedId, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        Assert.False((await new PushDispatchStore(_db).GetContextsAsync([notification], DateTimeOffset.UtcNow))[notification.Id].IsRelevant);
    }

    [Fact]
    public async Task WhileThePublicLinkIsOff_NobodyIsSentAnything()
    {
        await InviteAndAcceptAsync(_viewer, CollectionCollaboratorRole.Viewer);

        var conflict = await Assert.ThrowsAsync<CollectionCollaborationConflictException>(
            async () => await SendLink().ShareAsync(_viewer, _sharedId, [await JupleIdOfAsync(_stranger)]));

        Assert.Equal(CollectionCollaborationConflictException.PublicLinkInactive, conflict.Code);
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.CollectionLinkShared && entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task APendingInviteeOrAStranger_CannotPassTheLinkOn()
    {
        await _shares.EnableAsync(_owner, _sharedId, NewPublicId(), DateTimeOffset.UtcNow);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Viewer);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(async () => await SendLink().ShareAsync(_pending, _sharedId, [await JupleIdOfAsync(_viewer)]));
        await Assert.ThrowsAsync<CollectionNotFoundException>(async () => await SendLink().ShareAsync(_stranger, _sharedId, [await JupleIdOfAsync(_viewer)]));
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.CollectionLinkShared && entry.CollectionId == _sharedId));
    }

    // ---------- 컬렉션에서 제거 by a member ----------

    private RemoveItemFromCollectionService Remove() =>
        new(new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        })), TimeProvider.System), _collections, contributedLinks: _collections);

    [Fact]
    public async Task AMember_RemovesTheirOwnLink_OnlyTheLink_NeverTheItem_AndNeverSomeoneElsesLink()
    {
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        var ownerItem = await NewItemAsync(_owner, "https://example.test/owner");
        var contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor");
        await _addItem.AddAsync(_owner, _sharedId, ownerItem);
        await _addItem.AddAsync(_contributor, _sharedId, contributorItem);
        _db.ChangeTracker.Clear();

        // Someone else's link: refused, nothing removed.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => Remove().RemoveAsync(_contributor, _sharedId, ownerItem));
        Assert.True(await LinkedAsync(ownerItem));

        await Remove().RemoveAsync(_contributor, _sharedId, contributorItem);

        Assert.False(await LinkedAsync(contributorItem));
        // The Item itself stays in the member's own library.
        Assert.True(await _db.Items.AsNoTracking().AnyAsync(item => item.Id == contributorItem && item.UserId == _contributor && item.DeletedAtUtc == null));
        Assert.True(await LinkedAsync(ownerItem));
        // Idempotent like the Owner's removal.
        await Remove().RemoveAsync(_contributor, _sharedId, contributorItem);
    }

    [Fact]
    public async Task AMemberWhoIsNowAViewer_StillRemovesTheLinksTheyAdded()
    {
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        var contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor");
        await _addItem.AddAsync(_contributor, _sharedId, contributorItem);
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _contributor)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Viewer));
        _db.ChangeTracker.Clear();

        await Remove().RemoveAsync(_contributor, _sharedId, contributorItem);

        Assert.False(await LinkedAsync(contributorItem));
    }

    [Fact]
    public async Task APendingInviteeOrAStranger_RemovesNothing_AndTheOwnerStillRemovesAnyLink()
    {
        await InviteAndAcceptAsync(_contributor, CollectionCollaboratorRole.Contributor);
        var contributorItem = await NewItemAsync(_contributor, "https://example.test/contributor");
        await _addItem.AddAsync(_contributor, _sharedId, contributorItem);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pending), CollectionCollaboratorRole.Contributor);
        _db.ChangeTracker.Clear();

        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Remove().RemoveAsync(_pending, _sharedId, contributorItem));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => Remove().RemoveAsync(_stranger, _sharedId, contributorItem));
        Assert.True(await LinkedAsync(contributorItem));

        await Remove().RemoveAsync(_owner, _sharedId, contributorItem);
        Assert.False(await LinkedAsync(contributorItem));
        Assert.True(await _db.Items.AsNoTracking().AnyAsync(item => item.Id == contributorItem && item.DeletedAtUtc == null));
    }

    private Task<bool> LinkedAsync(long itemId) =>
        _db.CollectionItems.AsNoTracking().AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == itemId);

    // ---------- helpers ----------

    private Task<CollectionItemPage> ItemsAsync(long userId) =>
        new GetCollectionItemsService(
            new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
            {
                EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
            })), TimeProvider.System),
            _collections,
            new FakeImageStorage()).GetAsync(userId, _sharedId, null, 50);

    private async Task InviteAndAcceptAsync(long inviteeId, CollectionCollaboratorRole role)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId), role);
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
        _db.ChangeTracker.Clear();
    }

    private async Task SetProfilePhotoAsync(long userId, string blobName)
    {
        await _db.Database.ExecuteSqlInterpolatedAsync($"UPDATE users.Users SET ProfileImageBlobName = {blobName} WHERE Id = {userId}");
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

    /// <summary>No Blob I/O; signs deterministically and counts signatures.</summary>
    private sealed class FakeProfileImageStorage : IUserProfileImageStorage
    {
        private int signCount;

        public int SignCount => signCount;

        public Task<string> UploadProfileImageAsync(long userId, ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.CompletedTask;

        public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref signCount);
            return Task.FromResult<Uri?>(new Uri($"https://blob.example/{blobName}"));
        }
    }
}
