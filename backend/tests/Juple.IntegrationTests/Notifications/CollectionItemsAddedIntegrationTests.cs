using System.Security.Cryptography;
using Juple.Api.Configuration;
using Juple.Application.Collections;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.AddItemToCollections;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.CopyItems;
using Juple.Application.Collections.EnableCollectionShare;
using Juple.Application.Collections.GetCollectionItems;
using Juple.Application.Collections.MergeCollections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.TransferCollectionItem;
using Juple.Application.Images;
using Juple.Domain.Images;
using Juple.Application.Collections.NotificationPreference;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Api.Collections;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Notifications;

/// <summary>
/// 새 링크 알림 against the real schema: one visible Push per add operation to the Owner and accepted
/// members (never the actor, a pending invitee or anyone who turned it off), each participant's own
/// preference, and 내 컬렉션으로 복사 - independent copies of only the shared fields, de-duplicated by
/// URL, with one grouped notification for the destination.
/// </summary>
public sealed class CollectionItemsAddedIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _pendingInvitee;
    private long _sharedId;
    private CollectionCollaborationService _collaboration = null!;
    private AddItemToCollectionService _addItem = null!;
    private SocialNotificationPublisher _publisher = null!;
    private CollectionStore _collections = null!;
    private CollectionNotificationPreferenceService _preferences = null!;
    private CopyCollectionItemsService _copy = null!;
    private readonly RecordingPushSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _pendingInvitee = await NewUserAsync();
        var profiles = new UserProfileService(new UserProfileStore(_db), TimeProvider.System);
        await profiles.SetDisplayNameAsync(_owner, "피카츄");
        await profiles.SetDisplayNameAsync(_member, "꼬부기");

        _publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collections = new CollectionStore(_db);
        _collaboration = new CollectionCollaborationService(access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System, _publisher);
        _addItem = new AddItemToCollectionService(access, _collections, TimeProvider.System, _publisher);
        _preferences = new CollectionNotificationPreferenceService(access, new CollectionNotificationPreferenceStore(_db), TimeProvider.System);
        _copy = new CopyCollectionItemsService(access, new CollectionItemCopyStore(_db), TimeProvider.System, _publisher);

        _sharedId = (await _collections.CreateAsync(_owner, "여행", "여행", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var accepted = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(_member, accepted.InvitationId);
        await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_pendingInvitee)); // never accepted
        _db.ChangeTracker.Clear();
        await RegisterDeviceAsync(_owner, "ko");
        await RegisterDeviceAsync(_member, "ko");
        await RegisterDeviceAsync(_pendingInvitee, "ko");
        await Dispatcher().RunOnceAsync(); // the invitation pushes above are not what these tests look at
        _sender.Clear();
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

    private DispatchPendingPushNotificationsService Dispatcher() =>
        Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.Dispatcher(_db, _sender);

    [Fact]
    public async Task AnAdd_PushesOnce_ToTheOtherAcceptedParticipants_Only()
    {
        var item = await NewItemAsync(_owner, "https://example.test/a");
        await _addItem.AddAsync(_owner, _sharedId, item);
        await _addItem.AddAsync(_owner, _sharedId, item); // already there: no second notification
        await Dispatcher().RunOnceAsync();

        var toMember = Assert.Single(Visible(_member));
        Assert.Equal("새 링크", toMember.Payload.Title);
        Assert.Equal("피카츄님이 '여행'에 새 링크를 추가했어요.", toMember.Payload.Body);
        Assert.Equal(_sharedId.ToString(), toMember.Payload.Data["collectionId"]);
        Assert.Equal(["collectionId"], toMember.Payload.Data.Keys); // no URL, memo or item id
        Assert.Empty(Visible(_owner)); // the actor is not told
        Assert.Empty(Visible(_pendingInvitee)); // a pending invitation is not membership

        // A member's add tells the Owner.
        var memberItem = await NewItemAsync(_member, "https://example.test/member");
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        await _addItem.AddAsync(_member, _sharedId, memberItem);
        await Dispatcher().RunOnceAsync();
        Assert.Equal("꼬부기님이 '여행'에 새 링크를 추가했어요.", Assert.Single(Visible(_owner)).Payload.Body);
    }

    [Fact]
    public async Task EachParticipant_OwnsTheirOwnPreference_DefaultOn()
    {
        Assert.True((await _preferences.GetAsync(_member, _sharedId)).NewItemNotificationsEnabled);
        Assert.True((await _preferences.GetAsync(_owner, _sharedId)).NewItemNotificationsEnabled);
        Assert.False(await _db.CollectionNotificationPreferences.AnyAsync(entry => entry.CollectionId == _sharedId));

        await _preferences.SetAsync(_member, _sharedId, false);
        await _preferences.SetAsync(_member, _sharedId, false); // idempotent upsert, still one row
        Assert.False((await _preferences.GetAsync(_member, _sharedId)).NewItemNotificationsEnabled);
        Assert.True((await _preferences.GetAsync(_owner, _sharedId)).NewItemNotificationsEnabled); // untouched
        Assert.Equal(1, await _db.CollectionNotificationPreferences.CountAsync(entry => entry.CollectionId == _sharedId));

        // Not a participant: indistinguishable from a missing Collection, for reading and writing.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _preferences.GetAsync(_pendingInvitee, _sharedId));
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _preferences.SetAsync(_pendingInvitee, _sharedId, false));

        var item = await NewItemAsync(_owner, "https://example.test/muted");
        await _addItem.AddAsync(_owner, _sharedId, item);
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.UserId == _member && entry.Type == NotificationType.CollectionItemsAdded));

        // Turned off after it was enqueued but before the dispatcher ran: skipped, never sent.
        await _preferences.SetAsync(_member, _sharedId, true);
        var late = await NewItemAsync(_owner, "https://example.test/late");
        await _addItem.AddAsync(_owner, _sharedId, late);
        await _preferences.SetAsync(_member, _sharedId, false);
        await Dispatcher().RunOnceAsync();
        Assert.Empty(Visible(_member));

        // Account deletion clears the user's own settings.
        await new AccountDeletionStore(_db).DeleteAllDataAsync(_member, $"test/{_member}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_member);
        Assert.False(await _db.CollectionNotificationPreferences.AnyAsync(entry => entry.UserId == _member));
    }

    [Fact]
    public async Task APublicLinkAdd_NeverNamesWhoAdded()
    {
        var outsider = await NewUserAsync();
        await _publisher.CollectionItemsAddedAsync(outsider, _sharedId, 1, hideActor: true);
        await Dispatcher().RunOnceAsync();

        Assert.False(await _db.Notifications.AnyAsync(entry => entry.Type == NotificationType.CollectionItemsAdded && entry.ActorUserId == outsider));
        Assert.Equal("'여행'에 공개 링크를 통해 새 링크가 추가됐어요.", Assert.Single(Visible(_owner)).Payload.Body);
        Assert.Single(Visible(_member));
    }

    [Fact]
    public async Task CopyToMyCollection_CopiesOnlySharedFields_DeDuplicates_AndNotifiesTheDestinationOnce()
    {
        var itemStore = new ItemStore(_db);
        var withDetails = await NewItemAsync(_owner, "https://example.test/one");
        await itemStore.UpdateDetailsAsync(_owner, withDetails, "Title One", "owner's private memo");
        await itemStore.SetPreviewImageUrlAsync(_owner, withDetails, "https://img.example.test/one.png");
        var second = await NewItemAsync(_owner, "https://example.test/two");
        var alreadyThere = await NewItemAsync(_owner, "https://example.test/dup");
        var removedSince = await NewItemAsync(_owner, "https://example.test/gone");
        foreach (var id in new[] { withDetails, second, alreadyThere, removedSince })
        {
            await _addItem.AddAsync(_owner, _sharedId, id);
        }

        await itemStore.DeleteAsync(_owner, removedSince, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();

        // The member's own Collection, itself shared with a friend of theirs.
        var destination = (await _collections.CreateAsync(_member, "Mine", "MINE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var existing = await NewItemAsync(_member, "https://example.test/dup");
        await _collections.AddAsync(_member, destination, existing, DateTimeOffset.UtcNow);
        var friend = await NewUserAsync();
        var invitation = await _collaboration.InviteAsync(_member, destination, await JupleIdOfAsync(friend), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(friend, invitation.InvitationId);
        await RegisterDeviceAsync(friend, "ko");
        await Dispatcher().RunOnceAsync();
        _sender.Clear();
        var sourceBefore = await _db.CollectionItems.AsNoTracking().CountAsync(entry => entry.CollectionId == _sharedId);

        var result = await _copy.CopyAsync(_member, _sharedId, [withDetails, second, alreadyThere, removedSince], destination, null);

        Assert.Equal(new CopyCollectionItemsResult(2, 1, 1), result);
        var copies = await (
                from membership in _db.CollectionItems.AsNoTracking()
                where membership.CollectionId == destination
                join item in _db.Items.AsNoTracking() on membership.ItemId equals item.Id
                orderby membership.SortOrder
                select new { item.Id, item.UserId, item.Url, item.Title, item.Memo, item.PreviewImageUrl, item.CoverImageId, membership.AddedByUserId })
            .ToListAsync();
        // In the source's own order (newest add on top there: two, then one), above what was already there.
        Assert.Equal(["https://example.test/two", "https://example.test/one", "https://example.test/dup"], copies.Select(copy => copy.Url));
        var first = copies[1];
        Assert.Equal(_member, first.UserId); // an independent Item of the copier's own
        Assert.NotEqual(withDetails, first.Id);
        Assert.Equal("Title One", first.Title);
        Assert.Null(first.Memo); // the owner's memo never travels
        Assert.Equal("https://img.example.test/one.png", first.PreviewImageUrl);
        Assert.Null(first.CoverImageId);
        Assert.Equal(_member, first.AddedByUserId);
        Assert.Equal(sourceBefore, await _db.CollectionItems.AsNoTracking().CountAsync(entry => entry.CollectionId == _sharedId));

        // Independent: editing the source afterwards changes nothing in the copy.
        await itemStore.UpdateDetailsAsync(_owner, withDetails, "Renamed", null);
        Assert.Equal("Title One", await _db.Items.AsNoTracking().Where(item => item.Id == first.Id).Select(item => item.Title).SingleAsync());

        await Dispatcher().RunOnceAsync();
        var grouped = Assert.Single(Visible(friend));
        Assert.Equal("'Mine'에 링크 2개가 추가됐어요.", grouped.Payload.Body);
        Assert.Empty(Visible(_owner)); // the source's people are never told
        Assert.Equal(2, await _db.Notifications.Where(entry => entry.UserId == friend && entry.Type == NotificationType.CollectionItemsAdded)
            .Select(entry => entry.ItemCount).SingleAsync());
    }

    [Fact]
    public async Task TheOwner_CopiesALinkAMemberAdded_AsTheirOwnIndependentItem_WithNothingPrivate()
    {
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        var itemStore = new ItemStore(_db);
        var membersItem = await NewItemAsync(_member, "https://example.test/members");
        await itemStore.UpdateDetailsAsync(_member, membersItem, "Member's title", "member's private memo");
        await _db.Items.Where(entry => entry.Id == membersItem).ExecuteUpdateAsync(setters => setters
            .SetProperty(entry => entry.PreviewImageUrl, "https://img.example.test/members.png")
            .SetProperty(entry => entry.CoverImageId, 777L));
        await _addItem.AddAsync(_member, _sharedId, membersItem);
        var ownerOther = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        var result = await _copy.CopyAsync(_owner, _sharedId, [membersItem], ownerOther, null);

        Assert.Equal(new CopyCollectionItemsResult(1, 0, 0), result);
        var copy = await (
                from membership in _db.CollectionItems.AsNoTracking()
                where membership.CollectionId == ownerOther
                join copied in _db.Items.AsNoTracking() on membership.ItemId equals copied.Id
                select new { copied.Id, copied.UserId, copied.Url, copied.Title, copied.Memo, copied.PreviewImageUrl, copied.CoverImageId, membership.AddedByUserId })
            .SingleAsync();
        Assert.NotEqual(membersItem, copy.Id); // a new Item - never a link to the member's own
        Assert.Equal(_owner, copy.UserId);
        Assert.Equal("https://example.test/members", copy.Url);
        Assert.Equal("Member's title", copy.Title);
        Assert.Equal("https://img.example.test/members.png", copy.PreviewImageUrl);
        Assert.Null(copy.Memo);
        Assert.Null(copy.CoverImageId);
        Assert.Equal(_owner, copy.AddedByUserId);
        // The member's Item and the source Collection are untouched.
        Assert.Equal(_member, await _db.Items.AsNoTracking().Where(entry => entry.Id == membersItem).Select(entry => entry.UserId).SingleAsync());
        Assert.True(await _db.CollectionItems.AsNoTracking().AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == membersItem));
    }

    [Fact]
    public async Task CopyToMyCollection_OnlyFromSharedToMe_IntoMyOwn_RespectingLocks()
    {
        var item = await NewItemAsync(_owner, "https://example.test/x");
        await _addItem.AddAsync(_owner, _sharedId, item);
        var ownerOther = (await _collections.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var mine = (await _collections.CreateAsync(_member, "Mine", "MINE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();

        // The Owner's own links never take the copy path (they are replicated/moved) - nothing written.
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _copy.CopyAsync(_owner, _sharedId, [item], ownerOther, null));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == ownerOther));
        // A pending invitee sees no source either.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _copy.CopyAsync(_pendingInvitee, _sharedId, [item], ownerOther, null));
        // Someone else's Collection as the destination: no access at all.
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _copy.CopyAsync(_member, _sharedId, [item], ownerOther, null));
        // A Collection the caller only participates in is not theirs to copy into.
        var anotherShared = (await _collections.CreateAsync(_owner, "Shared2", "SHARED2", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var invitation = await _collaboration.InviteAsync(_owner, anotherShared, await JupleIdOfAsync(_member));
        await _collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => _copy.CopyAsync(_member, _sharedId, [item], anotherShared, null));
        // A stranger sees no source.
        var stranger = await NewUserAsync();
        await Assert.ThrowsAsync<CollectionNotFoundException>(() => _copy.CopyAsync(stranger, _sharedId, [item], mine, null));
        // Bounds.
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _copy.CopyAsync(_member, _sharedId, [], mine, null));
        await Assert.ThrowsAsync<InvalidCollectionException>(() => _copy.CopyAsync(
            _member, _sharedId, Enumerable.Range(1, CopyCollectionItemsService.MaxItemsPerCopy + 1).Select(id => (long)id).ToList(), mine, null));

        // A locked destination needs its own grant.
        await _db.Collections.Where(entry => entry.Id == mine)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.IsLocked, true));
        await Assert.ThrowsAsync<CollectionLockedException>(() => _copy.CopyAsync(_member, _sharedId, [item], mine, null));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == mine));
    }

    [Fact]
    public async Task APublicLinkWrite_ThroughTheRealService_NamesNobody_AndARepeatAddsNothing()
    {
        // "모든 사용자: 작성" requires every member to be able to write too (existing rule).
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        await _db.CollectionInvitations.Where(entry => entry.InvitedUserId == _pendingInvitee)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        var shares = new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System);
        var share = await shares.EnableAsync(_owner, _sharedId);
        await shares.SetPermissionAsync(_owner, _sharedId, CollectionSharePermission.Write);
        var publicWrite = new PublicCollectionWriteService(new PublicCollectionStore(_db), _collections, Tokens(), TimeProvider.System, _publisher);
        var outsider = await NewUserAsync();
        var item = await NewItemAsync(outsider, "https://example.test/public");

        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await publicWrite.AddItemAsync(outsider, share.PublicId, item, null));
        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, await publicWrite.AddItemAsync(outsider, share.PublicId, item, null)); // already there

        var events = await ItemsAddedEvents(_sharedId);
        Assert.Equal(2, events.Count); // owner + accepted member, once each
        Assert.All(events, entry => Assert.Null(entry.ActorUserId));
        Assert.Equal([_owner, _member], events.Select(entry => entry.UserId).Order());
    }

    [Fact]
    public async Task CopyingFive_IsOneGroupedEvent_AndIntoAnUnsharedCollection_NoEvent()
    {
        var ids = new List<long>();
        for (var index = 0; index < 5; index++)
        {
            var item = await NewItemAsync(_owner, $"https://example.test/five-{index}");
            await _addItem.AddAsync(_owner, _sharedId, item);
            ids.Add(item);
        }

        var destination = (await _collections.CreateAsync(_member, "Five", "FIVE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var unshared = (await _collections.CreateAsync(_member, "Private", "PRIVATE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var friend = await NewUserAsync();
        var invitation = await _collaboration.InviteAsync(_member, destination, await JupleIdOfAsync(friend), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(friend, invitation.InvitationId);
        _db.ChangeTracker.Clear();

        Assert.Equal(5, (await _copy.CopyAsync(_member, _sharedId, ids, destination, null)).Copied);
        Assert.Equal(5, (await _copy.CopyAsync(_member, _sharedId, ids, unshared, null)).Copied);

        var grouped = Assert.Single(await ItemsAddedEvents(destination));
        Assert.Equal((friend, 5, _member), (grouped.UserId, grouped.ItemCount!.Value, grouped.ActorUserId!.Value));
        Assert.Empty(await ItemsAddedEvents(unshared)); // nobody else there - the actor is never told
    }

    [Fact]
    public async Task CopyReusingMyOwnLink_IntoMySharedCollection_NeverShowsItsMemoOrPhotosToTheOthers()
    {
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        // The member's own link - with a private memo and an uploaded photo - added to the shared source.
        var own = await NewItemAsync(_member, "https://example.test/private-details");
        var tracked = await _db.Items.SingleAsync(entry => entry.Id == own);
        tracked.UpdateDetails("Mine", "member private memo");
        var photo = new ItemImage(own, $"users/{_member}/items/{own}/photo.jpg", "image/jpeg", 10, 0, DateTimeOffset.UtcNow);
        _db.ItemImages.Add(photo);
        await _db.SaveChangesAsync();
        tracked.SetCoverImageId(photo.Id);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        await _addItem.AddAsync(_member, _sharedId, own);

        // Copied into the member's OWN Collection, which is itself shared with a friend.
        var destination = (await _collections.CreateAsync(_member, "Shared mine", "SHARED MINE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var friend = await NewUserAsync();
        var invitation = await _collaboration.InviteAsync(_member, destination, await JupleIdOfAsync(friend), CollectionCollaboratorRole.Viewer);
        await _collaboration.AcceptInvitationAsync(friend, invitation.InvitationId);
        _db.ChangeTracker.Clear();

        Assert.Equal(1, (await _copy.CopyAsync(_member, _sharedId, [own], destination, null)).Copied);
        Assert.Equal(1, await _db.Items.CountAsync(entry => entry.UserId == _member && entry.Url == "https://example.test/private-details")); // reused, not duplicated

        var items = new GetCollectionItemsService(Access(), _collections, new FakeImageStorage());
        var friendView = (await items.GetAsync(friend, destination, null, 50)).Items.Single();
        Assert.False(friendView.IsMine);
        Assert.Null(friendView.Memo);
        Assert.Null(friendView.CoverImage);
        Assert.Null(friendView.RepresentativeImage);
        var ownerView = (await items.GetAsync(_owner, _sharedId, null, 50)).Items.Single(entry => entry.ItemId == own);
        Assert.Null(ownerView.Memo); // nor to the source's Owner
        Assert.Null(ownerView.CoverImage);
        // The member still sees their own private details.
        Assert.Equal("member private memo", (await items.GetAsync(_member, destination, null, 50)).Items.Single().Memo);
    }

    [Fact]
    public async Task TransferAndMerge_NeverReachAnyone_AndARefusedOneLeavesNothingBehind()
    {
        var store = _collections;
        var transfer = new TransferCollectionItemService(Access(), store, _publisher);
        var merge = new MergeCollectionsService(Access(), store, _publisher);
        var source = (await store.CreateAsync(_owner, "Src", "SRC", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        // The only "shared" target a transfer/merge may use: an active public link, no members.
        var linked = (await store.CreateAsync(_owner, "Linked", "LINKED", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        await new EnableCollectionShareService(new CollectionShareStore(_db), TimeProvider.System).EnableAsync(_owner, linked);
        var a = await NewItemAsync(_owner, "https://example.test/t-a");
        var b = await NewItemAsync(_owner, "https://example.test/t-b");
        var c = await NewItemAsync(_owner, "https://example.test/t-c");
        foreach (var id in new[] { a, b, c })
        {
            await _addItem.AddAsync(_owner, source, id);
        }

        await _addItem.AddAsync(_owner, linked, c); // c is a duplicate for both operations
        _db.ChangeTracker.Clear();

        Assert.True((await transfer.TransferAsync(_owner, source, a, linked)).TargetMembershipCreated);
        Assert.False((await transfer.TransferAsync(_owner, source, c, linked)).TargetMembershipCreated); // duplicate-only
        await _addItem.AddAsync(_owner, source, c);
        _db.ChangeTracker.Clear();
        var merged = await merge.MergeAsync(_owner, source, linked);
        Assert.Equal(1, merged.AddedToTargetCount); // b is new; c was already there
        Assert.Empty(await ItemsAddedEvents(linked)); // the Owner is the actor, and there is nobody else

        // A shared (collaborative) Collection is refused for transfer/merge - rolled back, nobody told.
        var other = (await store.CreateAsync(_owner, "Other", "OTHER", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var d = await NewItemAsync(_owner, "https://example.test/t-d");
        await _addItem.AddAsync(_owner, other, d);
        _db.ChangeTracker.Clear();
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => transfer.TransferAsync(_owner, other, d, _sharedId));
        await Assert.ThrowsAsync<CollectionCollaborationConflictException>(() => merge.MergeAsync(_owner, other, _sharedId));
        _db.ChangeTracker.Clear();
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == _sharedId && entry.ItemId == d));
        Assert.True(await _db.CollectionItems.AnyAsync(entry => entry.CollectionId == other && entry.ItemId == d));
        Assert.Null(await _db.Collections.Where(entry => entry.Id == other).Select(entry => entry.DeletedAtUtc).SingleAsync());
        Assert.Empty(await ItemsAddedEvents(_sharedId));
    }

    [Fact]
    public async Task ReplicatingToSeveralOfMyCollections_AddsEachOnce_AndNotifiesOnlyTheSharedOnesThatGainedIt()
    {
        var replicate = new AddItemToCollectionsService(Access(), _collections, new CollectionWriteTransactions(_db), TimeProvider.System, _publisher);
        var privateId = (await _collections.CreateAsync(_owner, "혼자", "혼자", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var alreadyThereId = (await _collections.CreateAsync(_owner, "이미", "이미", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var item = await NewItemAsync(_owner, "https://example.test/replicate");
        await _addItem.AddAsync(_owner, alreadyThereId, item);
        await Dispatcher().RunOnceAsync();
        _sender.Clear();

        // A repeated id counts once; the one it was already in is skipped.
        var result = await replicate.AddAsync(_owner, item, [_sharedId, privateId, alreadyThereId, _sharedId], null);
        await Dispatcher().RunOnceAsync();

        Assert.Equal(new AddItemToCollectionsResult(2, 1), result);
        foreach (var collectionId in new[] { _sharedId, privateId, alreadyThereId })
        {
            Assert.Equal(1, await _db.CollectionItems.CountAsync(entry => entry.CollectionId == collectionId && entry.ItemId == item));
        }

        // The member of the shared one hears about it once; the actor and the pending invitee never.
        Assert.Equal("피카츄님이 '여행'에 새 링크를 추가했어요.", Assert.Single(Visible(_member)).Payload.Body);
        Assert.Empty(Visible(_owner));
        Assert.Empty(Visible(_pendingInvitee));
        Assert.Single(await ItemsAddedEvents(_sharedId));
        Assert.Empty(await ItemsAddedEvents(privateId));

        // Again: nothing new anywhere, so nobody is told again.
        _sender.Clear();
        Assert.Equal(new AddItemToCollectionsResult(0, 3), await replicate.AddAsync(_owner, item, [_sharedId, privateId, alreadyThereId], null));
        await Dispatcher().RunOnceAsync();
        Assert.Empty(Visible(_member));
        Assert.Single(await ItemsAddedEvents(_sharedId));
    }

    [Fact]
    public async Task Replicating_IntoACollectionSharedWithMe_IsRefused_AndWritesNothing()
    {
        var replicate = new AddItemToCollectionsService(Access(), _collections, new CollectionWriteTransactions(_db), TimeProvider.System, _publisher);
        await _db.CollectionCollaborators.Where(entry => entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Contributor));
        var membersOwnId = (await _collections.CreateAsync(_member, "내것", "내것", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var item = await NewItemAsync(_member, "https://example.test/not-mine-to-fill");

        // Even as a Contributor who may add there one at a time, the shared Collection is not a
        // destination of this batch - and the refusal leaves the member's own one untouched too.
        await Assert.ThrowsAsync<CollectionForbiddenException>(() => replicate.AddAsync(_member, item, [membersOwnId, _sharedId], null));
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.ItemId == item));
        // Someone else's Item is not found.
        var ownersItem = await NewItemAsync(_owner, "https://example.test/owners");
        await Assert.ThrowsAsync<Juple.Application.Items.ItemNotFoundException>(() => replicate.AddAsync(_member, ownersItem, [membersOwnId], null));
    }

    [Fact]
    public async Task ADatabaseFailurePartWayThroughTheWrites_RollsBackEveryLinkOfTheBatch()
    {
        var first = (await _collections.CreateAsync(_owner, "첫째", "첫째", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var second = (await _collections.CreateAsync(_owner, "둘째", "둘째", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var item = await NewItemAsync(_owner, "https://example.test/rollback-writes");
        var notificationsBefore = await _db.Notifications.CountAsync();
        // The first write really reaches the database (inside the transaction); the second fails.
        var failing = new FailingItemStore(_collections, failOnAddNumber: 2);
        var replicate = new AddItemToCollectionsService(Access(), failing, new CollectionWriteTransactions(_db), TimeProvider.System, _publisher);

        await Assert.ThrowsAsync<InvalidOperationException>(() => replicate.AddAsync(_owner, item, [_sharedId, first, second], null));

        Assert.Equal(1, failing.RealWrites);
        _db.ChangeTracker.Clear();
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.ItemId == item)); // the first write is gone too
        Assert.Equal(notificationsBefore, await _db.Notifications.CountAsync());

        // Nothing half-done is left behind: the same batch simply succeeds afterwards.
        var retry = new AddItemToCollectionsService(Access(), _collections, new CollectionWriteTransactions(_db), TimeProvider.System, _publisher);
        Assert.Equal(new AddItemToCollectionsResult(3, 0), await retry.AddAsync(_owner, item, [_sharedId, first, second], null));
    }

    [Fact]
    public async Task AFailureAfterTheNotificationRowsWereWritten_RollsBackTheLinksAndThoseRows()
    {
        var other = (await _collections.CreateAsync(_owner, "다른", "다른", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _db.ChangeTracker.Clear();
        var item = await NewItemAsync(_owner, "https://example.test/rollback-notifications");
        var sharedEventsBefore = (await ItemsAddedEvents(_sharedId)).Count;
        // The real publisher writes the new-link row for the shared Collection, then the next write fails.
        var failing = new FailingAfterItemsAddedPublisher(_publisher);
        var replicate = new AddItemToCollectionsService(Access(), _collections, new CollectionWriteTransactions(_db), TimeProvider.System, failing);

        await Assert.ThrowsAsync<InvalidOperationException>(() => replicate.AddAsync(_owner, item, [_sharedId, other], null));

        Assert.True(failing.RealRowsWritten);
        _db.ChangeTracker.Clear();
        Assert.False(await _db.CollectionItems.AnyAsync(entry => entry.ItemId == item));
        Assert.Equal(sharedEventsBefore, (await ItemsAddedEvents(_sharedId)).Count); // the row it wrote is gone
        await Dispatcher().RunOnceAsync();
        Assert.Empty(Visible(_member)); // nobody is told about a link that is not there
    }

    // ---------- helpers ----------

    /// <summary>The real CollectionStore, except that the Nth AddAsync fails like a broken database write.</summary>
    private sealed class FailingItemStore(CollectionStore inner, int failOnAddNumber) : ICollectionItemStore
    {
        private int _calls;

        public int RealWrites { get; private set; }

        public Task<(CollectionItemPage Page, IReadOnlyDictionary<long, ItemRepresentativeImageRef> RepresentativeImages, IReadOnlyDictionary<long, ItemRepresentativeImageRef> CoverImages)> GetItemsAsync(
            long userId, long collectionId, CollectionItemPageCursor? cursor, int limit, CollectionItemSort sort = CollectionItemSort.Manual, CancellationToken cancellationToken = default) =>
            inner.GetItemsAsync(userId, collectionId, cursor, limit, sort, cancellationToken);

        public Task<SharedCollectionItemDto?> GetSharedItemAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            inner.GetSharedItemAsync(userId, collectionId, itemId, cancellationToken);

        public async Task<bool> AddAsync(long userId, long collectionId, long itemId, DateTimeOffset addedAtUtc, CancellationToken cancellationToken = default)
        {
            if (++_calls == failOnAddNumber)
            {
                throw new InvalidOperationException("database write failed");
            }

            var added = await inner.AddAsync(userId, collectionId, itemId, addedAtUtc, cancellationToken);
            RealWrites++;
            return added;
        }

        public Task RemoveAsync(long userId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
            inner.RemoveAsync(userId, collectionId, itemId, cancellationToken);

        public Task MoveItemAsync(long userId, long collectionId, long itemId, long? afterItemId, CancellationToken cancellationToken = default) =>
            inner.MoveItemAsync(userId, collectionId, itemId, afterItemId, cancellationToken);
    }

    /// <summary>The real publisher; right after it has written a new-link row, the operation fails.</summary>
    private sealed class FailingAfterItemsAddedPublisher(ISocialNotificationPublisher inner) : ISocialNotificationPublisher
    {
        public bool RealRowsWritten { get; private set; }

        public Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default) =>
            inner.FriendRequestReceivedAsync(requesterUserId, recipientUserId, friendshipId, cancellationToken);

        public Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, bool accepted, CancellationToken cancellationToken = default) =>
            inner.FriendRequestAnsweredAsync(answererUserId, requesterUserId, friendshipId, accepted, cancellationToken);

        public Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default) =>
            inner.CollectionInvitationReceivedAsync(ownerUserId, invitedUserId, collectionId, invitationId, cancellationToken);

        public Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default) =>
            inner.CollectionInvitationAnsweredAsync(inviteeUserId, invitationId, cancellationToken);

        public Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default) =>
            inner.CollectionsChangedAsync(actorUserId, collectionIds, cancellationToken);

        public Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default) =>
            inner.ItemCollectionsChangedAsync(actorUserId, itemId, cancellationToken);

        public async Task CollectionItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, CancellationToken cancellationToken = default)
        {
            await inner.CollectionItemsAddedAsync(actorUserId, collectionId, itemCount, hideActor, cancellationToken);
            RealRowsWritten = true;
            throw new InvalidOperationException("database write failed after the notification row");
        }
    }

    private CollectionUnlockTokenProtector Tokens() => new(Options.Create(new CollectionUnlockGrantOptions
    {
        EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
    }));

    private CollectionAccessService Access() => new(new CollectionAccessStore(_db), Tokens(), TimeProvider.System);

    /// <summary>The new-link notifications of the Collection - after the outbox recorded by the actions has been materialized.</summary>
    private async Task<List<Notification>> ItemsAddedEvents(long collectionId)
    {
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        return await _db.Notifications.AsNoTracking()
            .Where(entry => entry.Type == NotificationType.CollectionItemsAdded && entry.CollectionId == collectionId)
            .ToListAsync();
    }

    private sealed class FakeImageStorage : IItemImageStorage
    {
        public Task DeleteItemBlobsAsync(long userId, long itemId, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public string GetUserBlobPrefix(long userId) => $"users/{userId}/";

        public Task<bool> DeleteBlobsByPrefixAsync(string prefix, CancellationToken cancellationToken = default) => Task.FromResult(true);

        public Task<Uri?> CreateReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default) =>
            Task.FromResult<Uri?>(new Uri($"https://blob.example.test/{blobName}"));
    }

    private IReadOnlyList<(long UserId, PushNotificationPayload Payload)> Visible(long userId) =>
        _sender.SentTo(userId).Where(sent => sent.Payload.Type == "collectionItemsAdded").ToList();

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task RegisterDeviceAsync(long userId, string locale)
    {
        await new PushDeviceRegistrationStore(_db).RegisterAsync(
            userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), locale, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class RecordingPushSender : IPushSender
    {
        private readonly List<(long UserId, PushNotificationPayload Payload)> _sent = [];

        public IReadOnlyList<(long UserId, PushNotificationPayload Payload)> SentTo(long userId) =>
            _sent.Where(sent => sent.UserId == userId).ToList();

        public void Clear() => _sent.Clear();

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            _sent.Add((device.UserId, payload));
            return Task.FromResult(PushSendResult.Sent("test-message"));
        }
    }
}
