using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.RemoveItemFromCollection;
using Juple.Application.Friends;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Friends;
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
/// The social Push outbox against the real schema: friend requests and Collection invitations
/// enqueue once and are sent to every enabled device with the recipient's pending-request count;
/// answers and content changes become data-only refresh signals for the other people involved;
/// anything answered/revoked/expired before the dispatcher runs is skipped, never sent late.
/// </summary>
public sealed class SocialPushNotificationsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _stranger;
    private long _sharedId;
    private long _privateId;
    private FriendService _friends = null!;
    private CollectionCollaborationService _collaboration = null!;
    private AddItemToCollectionService _addItem = null!;
    private RemoveItemFromCollectionService _removeItem = null!;
    private SocialNotificationPublisher _publisher = null!;
    private CollectionStore _collections = null!;
    private readonly RecordingPushSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _stranger = await NewUserAsync();
        await new UserProfileService(new UserProfileStore(_db), TimeProvider.System).SetDisplayNameAsync(_owner, "피카츄");

        _publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        var directory = new UserDirectoryStore(_db);
        var tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        var access = new CollectionAccessService(new CollectionAccessStore(_db), tokens, TimeProvider.System);
        _collections = new CollectionStore(_db);
        _friends = new FriendService(directory, new FriendStore(_db), TimeProvider.System, _publisher);
        _collaboration = new CollectionCollaborationService(access, directory, new CollectionCollaborationStore(_db), TimeProvider.System, _publisher);
        _addItem = new AddItemToCollectionService(access, _collections, TimeProvider.System, _publisher);
        _removeItem = new RemoveItemFromCollectionService(access, _collections, _publisher);

        _sharedId = (await _collections.CreateAsync(_owner, "여행", "여행", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        _privateId = (await _collections.CreateAsync(_owner, "Private", "PRIVATE", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
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

    private DispatchPendingPushNotificationsService Dispatcher(TimeProvider? time = null) =>
        Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.Dispatcher(_db, _sender, time);

    [Fact]
    public async Task AFriendRequest_IsPushedOnce_WithTheSendersName_AndThePendingCount()
    {
        await RegisterDeviceAsync(_member, "ko");
        var request = await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_member));

        await Dispatcher().RunOnceAsync();
        await Dispatcher().RunOnceAsync(); // a second pass never sends it again

        var sent = Assert.Single(_sender.SentTo(_member));
        Assert.Equal("friendRequest", sent.Payload.Type);
        Assert.Equal("친구 신청", sent.Payload.Title);
        Assert.Equal("피카츄님이 친구 신청을 보냈어요.", sent.Payload.Body);
        Assert.Equal(1, sent.Payload.BadgeCount);
        Assert.Equal(1, await _db.Notifications.CountAsync(entry => entry.DedupKey == $"friend-request:{request.RequestId}"));
    }

    [Fact]
    public async Task AnsweringAFriendRequest_TellsTheRequester_DataOnly_WithoutAnyId()
    {
        await RegisterDeviceAsync(_owner, "ko");
        var accepted = await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_member));
        await _friends.AcceptAsync(_member, accepted.RequestId);
        await _friends.AcceptAsync(_member, accepted.RequestId); // an idempotent replay enqueues nothing new
        var declined = await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_stranger));
        await _friends.DeclineAsync(_stranger, declined.RequestId);
        var cancelled = await _friends.SendRequestAsync(_stranger, await JupleIdOfAsync(_owner));
        await _friends.CancelAsync(_stranger, cancelled.RequestId); // the requester cancelling tells nobody

        await Dispatcher().RunOnceAsync();

        var sent = _sender.SentTo(_owner);
        Assert.Equal(2, sent.Count);
        Assert.All(sent, message =>
        {
            Assert.Equal("friendRequestAnswered", message.Payload.Type);
            Assert.Null(message.Payload.Title); // data-only: refreshes the Friends screen, no tray notification
            Assert.Empty(message.Payload.Data);
        });
        Assert.Equal(1, await _db.Notifications.CountAsync(entry => entry.DedupKey == $"friend-request-answered:{accepted.RequestId}"));
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.DedupKey == $"friend-request-answered:{cancelled.RequestId}"));
    }

    [Fact]
    public async Task AnInvitation_IsPushedWithTheCollectionName_AndItsAnswerTellsTheOwner_DataOnly()
    {
        await RegisterDeviceAsync(_member, "en");
        await RegisterDeviceAsync(_owner, "ko");
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Viewer);
        await Dispatcher().RunOnceAsync();

        var invite = Assert.Single(_sender.SentTo(_member));
        Assert.Equal("collectionInvitation", invite.Payload.Type);
        Assert.Equal("피카츄 shared the collection \"여행\" with you.", invite.Payload.Body);
        Assert.Equal(_sharedId.ToString(), invite.Payload.Data["collectionId"]);

        await _collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);
        await Dispatcher().RunOnceAsync();

        var answered = Assert.Single(_sender.SentTo(_owner));
        Assert.Equal("collectionInvitationAnswered", answered.Payload.Type);
        Assert.Null(answered.Payload.Title); // data-only: refreshes the Share screen, no tray notification
        Assert.Equal(invitation.InvitationId.ToString(), answered.Payload.Data["invitationId"]);
    }

    [Fact]
    public async Task AnswerOrRevokeBeforeDispatch_MeansNothingIsSent()
    {
        await RegisterDeviceAsync(_member, "ko");
        var request = await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_member));
        await _friends.DeclineAsync(_member, request.RequestId);
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Viewer);
        await _collaboration.RevokeInvitationAsync(_owner, _sharedId, invitation.InvitationId);

        var result = await Dispatcher().RunOnceAsync();

        Assert.Empty(_sender.SentTo(_member));
        Assert.True(result.Skipped >= 2);
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.UserId == _member && entry.DispatchedAtUtc == null));
    }

    [Fact]
    public async Task TooOldNotifications_Expire_InsteadOfBeingSentLate()
    {
        await RegisterDeviceAsync(_member, "ko");
        await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_member));

        var result = await Dispatcher(new ShiftedTimeProvider(SocialNotificationPolicy.VisibleMaxAge + TimeSpan.FromMinutes(1))).RunOnceAsync();

        Assert.Empty(_sender.SentTo(_member));
        Assert.True(result.Expired >= 1);
    }

    [Fact]
    public async Task ContentChanges_ReachEveryOtherMember_OnlyForSharedCollections_Coalesced()
    {
        await InviteAndAcceptAsync(_member);
        await RegisterDeviceAsync(_owner, "ko");
        await RegisterDeviceAsync(_member, "ko");
        var ownerItem = await NewItemAsync(_owner, "https://example.test/a");
        var ownerItem2 = await NewItemAsync(_owner, "https://example.test/b");
        var privateItem = await NewItemAsync(_owner, "https://example.test/private");

        await _addItem.AddAsync(_owner, _sharedId, ownerItem);
        await _addItem.AddAsync(_owner, _sharedId, ownerItem2); // same minute: coalesced
        await _addItem.AddAsync(_owner, _privateId, privateItem); // not shared: nobody to tell
        await _removeItem.RemoveAsync(_owner, _sharedId, ownerItem2);
        await Dispatcher().RunOnceAsync();

        var toMember = _sender.SentTo(_member).Where(sent => sent.Payload.Type == "collectionContentChanged").ToList();
        var single = Assert.Single(toMember);
        Assert.Null(single.Payload.Title);
        Assert.Equal(_sharedId.ToString(), single.Payload.Data["collectionId"]);
        Assert.DoesNotContain(_sender.SentTo(_owner), sent => sent.Payload.Type == "collectionContentChanged"); // the actor is not told

        // A member's own change tells the Owner.
        var memberItem = await NewItemAsync(_member, "https://example.test/member");
        await _db.Database.ExecuteSqlRawAsync("UPDATE notifications.Notifications SET DedupKey = DedupKey + ':old' WHERE UserId IN ({0}, {1})", _owner, _member);
        await _addItem.AddAsync(_member, _sharedId, memberItem);
        await Dispatcher().RunOnceAsync();
        Assert.Contains(_sender.SentTo(_owner), sent => sent.Payload.Type == "collectionContentChanged");
    }

    [Fact]
    public async Task ItemDeletion_TellsTheMembersOfTheSharedCollectionsItIsIn()
    {
        await InviteAndAcceptAsync(_member);
        var item = await NewItemAsync(_owner, "https://example.test/deleted");
        await _addItem.AddAsync(_owner, _sharedId, item);
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM notifications.Notifications WHERE UserId = {0}", _member);

        await _publisher.ItemCollectionsChangedAsync(_owner, item);
        // One item-wide outbox event; processing expands it into each shared Collection it is in.
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);

        Assert.True(await _db.Notifications.AnyAsync(entry =>
            entry.UserId == _member && entry.Type == NotificationType.CollectionContentChanged && entry.CollectionId == _sharedId));
    }

    [Fact]
    public async Task NoDevice_OrADeadToken_NeverRetriesForever()
    {
        await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_member));
        var noDevice = await Dispatcher().RunOnceAsync();
        Assert.True(noDevice.Skipped >= 1);

        var device = await RegisterDeviceAsync(_stranger, "ko");
        _sender.FailWith = PushSendFailureCodes.Unregistered;
        await _friends.SendRequestAsync(_owner, await JupleIdOfAsync(_stranger));
        await Dispatcher().RunOnceAsync();

        Assert.False((await _db.PushDeviceRegistrations.AsNoTracking().SingleAsync(entry => entry.Id == device)).IsEnabled);
        Assert.False(await _db.Notifications.AnyAsync(entry => entry.UserId == _stranger && entry.DispatchedAtUtc == null));
    }

    [Fact]
    public async Task AccountDeletion_RemovesNotificationsTheUserCausedForOthers()
    {
        await _friends.SendRequestAsync(_stranger, await JupleIdOfAsync(_member));
        await _friends.SendRequestAsync(_stranger, await JupleIdOfAsync(_owner));
        // One materialized, one still only an outbox event: both go with the account.
        await Juple.IntegrationTests.TestSupport.NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        await _db.NotificationEvents.Where(entry => entry.ActorUserId == _stranger && entry.RecipientUserId == _owner)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(entry => entry.Status, NotificationEventStatus.Pending)
                .SetProperty(entry => entry.CompletedAtUtc, (DateTimeOffset?)null));
        Assert.True(await _db.Notifications.AnyAsync(entry => entry.ActorUserId == _stranger));
        Assert.True(await _db.NotificationEvents.AnyAsync(entry => entry.ActorUserId == _stranger));

        await new AccountDeletionStore(_db).DeleteAllDataAsync(_stranger, $"test/{_stranger}/", DateTimeOffset.UtcNow);
        _userIds.Remove(_stranger);

        Assert.False(await _db.Notifications.AnyAsync(entry => entry.ActorUserId == _stranger));
        Assert.False(await _db.NotificationEvents.AnyAsync(entry => entry.ActorUserId == _stranger || entry.RecipientUserId == _stranger));
    }

    // ---------- helpers ----------

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> RegisterDeviceAsync(long userId, string locale)
    {
        var registration = await new PushDeviceRegistrationStore(_db).RegisterAsync(
            userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), locale, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return await _db.PushDeviceRegistrations.AsNoTracking()
            .Where(entry => entry.UserId == userId)
            .OrderByDescending(entry => entry.Id)
            .Select(entry => entry.Id)
            .FirstAsync();
    }

    private async Task InviteAndAcceptAsync(long inviteeId)
    {
        var invitation = await _collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(inviteeId));
        await _collaboration.AcceptInvitationAsync(inviteeId, invitation.InvitationId);
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

        public string? FailWith { get; set; }

        public IReadOnlyList<(long UserId, PushNotificationPayload Payload)> SentTo(long userId) =>
            _sent.Where(sent => sent.UserId == userId).ToList();

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            if (FailWith is { } code)
            {
                return Task.FromResult(PushSendResult.Failed(code));
            }

            _sent.Add((device.UserId, payload));
            return Task.FromResult(PushSendResult.Sent("test-message"));
        }
    }

    private sealed class ShiftedTimeProvider(TimeSpan shift) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => TimeProvider.System.GetUtcNow() + shift;
    }
}
