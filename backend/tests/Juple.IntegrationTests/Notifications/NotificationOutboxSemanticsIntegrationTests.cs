using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
using Juple.Application.Collections.Reactions;
using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.Domain.Users;
using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Items;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;
using Juple.Infrastructure.Users;
using Juple.Infrastructure.Users.DeleteAccount;
using Juple.IntegrationTests.TestSupport;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace Juple.IntegrationTests.Notifications;

/// <summary>
/// The outbox's two kinds of keys (see NotificationEventKeys) and the request's signal path, against
/// the real schema:
///  - idempotency: the same business operation recorded twice is one event and one notification -
///    even after the processed event was deleted by retention;
///  - coalescing: reactions by one person on one link within a minute are one notification, the next
///    window is a new one - an earlier, processed event never blocks a later legitimate one;
///  - events without a key (separate proposals) are never suppressed;
///  - the request hands its signal to the in-process channel and returns - a lost channel (process
///    gone, Service Bus down) loses nothing, the recovery Job processes the event.
/// </summary>
public sealed class NotificationOutboxSemanticsIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _sharedId;
    private CollectionUnlockTokenProtector _tokens = null!;
    private CollectionAccessService _access = null!;
    private readonly RecordingSender _sender = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _tokens = new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        }));
        _access = new CollectionAccessService(new CollectionAccessStore(_db), _tokens, TimeProvider.System);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();
        _sharedId = (await new CollectionStore(_db).CreateAsync(_owner, "Semantics", "SEMANTICS", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var collaboration = new CollectionCollaborationService(_access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System);
        var invitation = await collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Contributor);
        await collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);
        await new PushDeviceRegistrationStore(_db).RegisterAsync(
            _owner, PushPlatform.Android, Guid.NewGuid().ToString("N"), "test-token-" + Guid.NewGuid().ToString("N"), "ko", DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
    }

    public async Task DisposeAsync()
    {
        _db.ChangeTracker.Clear();
        foreach (var userId in _userIds)
        {
            await new AccountDeletionStore(_db).DeleteAllDataAsync(userId, $"test/{userId}/", DateTimeOffset.UtcNow);
        }

        await _db.NotificationEvents.Where(entry => entry.CollectionId == _sharedId).ExecuteDeleteAsync();
        await _db.Database.ExecuteSqlRawAsync("DELETE FROM images.AccountDeletionBlobCleanups WHERE BlobPrefix LIKE 'test/%'");
        await _db.DisposeAsync();
    }

    [Fact]
    public async Task Idempotency_TheSameOperationRecordedTwice_IsOneEventAndOneNotification_EvenAfterRetentionDeletedIt()
    {
        var publisher = Publisher(TimeProvider.System);
        // The request must still be waiting for its notification to be made (a cancelled one never reaches the Inbox).
        var request = Juple.Domain.Friends.Friendship.Request(_member, _owner, DateTimeOffset.UtcNow);
        _db.Friendships.Add(request);
        await _db.SaveChangesAsync();
        _db.ChangeTracker.Clear();
        var friendshipId = request.Id;

        await publisher.FriendRequestReceivedAsync(_member, _owner, friendshipId);
        await publisher.FriendRequestReceivedAsync(_member, _owner, friendshipId); // a retried request
        Assert.Equal(1, await _db.NotificationEvents.CountAsync(entry => entry.DedupKey == NotificationEventKeys.FriendRequestReceived(friendshipId)));
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);

        // Retention deletes the processed event; a late replay records a new one - and still no second notification.
        await _db.NotificationEvents.Where(entry => entry.DedupKey == NotificationEventKeys.FriendRequestReceived(friendshipId)).ExecuteDeleteAsync();
        await publisher.FriendRequestReceivedAsync(_member, _owner, friendshipId);
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);

        Assert.Equal(1, await _db.Notifications.CountAsync(entry => entry.UserId == _owner && entry.Type == NotificationType.FriendRequestReceived && entry.SubjectId == friendshipId));
        await _db.NotificationEvents.Where(entry => entry.DedupKey == NotificationEventKeys.FriendRequestReceived(friendshipId)).ExecuteDeleteAsync();
    }

    [Fact]
    public async Task Coalescing_ReactionsWithinAMinuteAreOne_TheNextWindowIsANewNotification_AndAProcessedOneNeverBlocksIt()
    {
        var link = await AddLinkAsync(_owner, "https://example.test/coalesce");
        var clock = new SettableTime(DateTimeOffset.UtcNow.AddMinutes(-30));
        var reactions = Reactions(clock);

        // Window 1: heart, then a change to fire 20 seconds later - grouped into one event/notification.
        clock.Now = Align(clock.Now);
        await reactions.SetAsync(_member, _sharedId, link, "heart", null);
        clock.Now += TimeSpan.FromSeconds(20);
        await reactions.SetAsync(_member, _sharedId, link, "fire", null);
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        Assert.Equal(1, await ReactionNotificationsAsync(link));

        // The first window's event is processed (and stays until retention) - it must not block window 2.
        Assert.All(await ReactionEventsAsync(), entry => Assert.Equal(NotificationEventStatus.Processed, entry.Status));
        clock.Now += SocialNotificationPolicy.CollaborationCoalescing;
        await reactions.SetAsync(_member, _sharedId, link, "heart", null);
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);
        Assert.Equal(2, await ReactionNotificationsAsync(link));

        // A day later: the same person, the same link - a new notification as well.
        clock.Now += TimeSpan.FromDays(1);
        await reactions.SetAsync(_member, _sharedId, link, "fire", null);
        Assert.Equal(3, (await ReactionEventsAsync()).Count);
    }

    [Fact]
    public async Task EventsWithoutAKey_SeparateProposals_AreNeverSuppressed()
    {
        await _db.CollectionCollaborators.Where(entry => entry.CollectionId == _sharedId && entry.UserId == _member)
            .ExecuteUpdateAsync(setters => setters.SetProperty(entry => entry.Role, CollectionCollaboratorRole.Submitter));
        var add = new AddItemToCollectionService(_access, new CollectionStore(_db), TimeProvider.System, Publisher(TimeProvider.System), new CollectionLinkSubmissionStore(_db));

        await add.AddAsync(_member, _sharedId, await NewItemAsync(_member, "https://example.test/proposal-1"));
        await add.AddAsync(_member, _sharedId, await NewItemAsync(_member, "https://example.test/proposal-2"));
        await NotificationPipelineTestKit.MaterializeOutboxAsync(_db);

        Assert.Equal(2, await _db.Notifications.CountAsync(entry => entry.UserId == _owner && entry.Type == NotificationType.CollectionLinkSubmissionReceived));
    }

    [Fact]
    public async Task TheRequest_HandsItsSignalToTheChannel_AndALostChannelLosesNothing()
    {
        var channel = new NotificationSignalChannel(new NotificationPipelineOptions { SignalChannelCapacity = 1 });
        var publisher = new SocialNotificationPublisher(
            _db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance,
            new ChannelNotificationSignal(channel, NullLogger<ChannelNotificationSignal>.Instance));
        var add = new AddItemToCollectionService(_access, new CollectionStore(_db), TimeProvider.System, publisher);

        // Capacity 1, two events (new link + refresh): one signal fits, one is dropped - the request succeeds anyway.
        var outcome = await add.AddAsync(_owner, _sharedId, await NewItemAsync(_owner, "https://example.test/signal"));

        Assert.Equal(Juple.Application.Collections.Submissions.CollectionLinkAddOutcome.Added, outcome);
        Assert.True(channel.Reader.TryRead(out var signaled));
        Assert.False(channel.Reader.TryRead(out _));
        var events = await _db.NotificationEvents.AsNoTracking().Where(entry => entry.CollectionId == _sharedId).ToListAsync();
        Assert.Equal(2, events.Count);
        Assert.Contains(events, entry => entry.Id == signaled);

        // The process dies with the channel - the recovery Job still delivers both events.
        await NotificationPipelineTestKit.Dispatcher(_db, _sender).RunOnceAsync();
        Assert.All(await _db.NotificationEvents.AsNoTracking().Where(entry => entry.CollectionId == _sharedId).ToListAsync(),
            entry => Assert.Equal(NotificationEventStatus.Processed, entry.Status));
    }

    private static DateTimeOffset Align(DateTimeOffset nowUtc)
    {
        var window = (long)SocialNotificationPolicy.CollaborationCoalescing.TotalSeconds;
        return DateTimeOffset.FromUnixTimeSeconds(nowUtc.ToUnixTimeSeconds() / window * window + 1);
    }

    private SocialNotificationPublisher Publisher(TimeProvider time) =>
        new(_db, time, NullLogger<SocialNotificationPublisher>.Instance);

    private CollectionItemReactionService Reactions(TimeProvider time) =>
        new(_access, new CollectionItemReactionStore(_db), time, Publisher(time));

    private Task<int> ReactionNotificationsAsync(long itemId) =>
        _db.Notifications.CountAsync(entry => entry.UserId == _owner && entry.Type == NotificationType.CollectionItemReactionReceived && entry.SubjectId == itemId);

    private Task<List<NotificationEvent>> ReactionEventsAsync() =>
        _db.NotificationEvents.AsNoTracking()
            .Where(entry => entry.CollectionId == _sharedId && entry.Type == NotificationType.CollectionItemReactionReceived)
            .ToListAsync();

    private async Task<long> AddLinkAsync(long userId, string url)
    {
        var item = await NewItemAsync(userId, url);
        await new AddItemToCollectionService(_access, new CollectionStore(_db), TimeProvider.System).AddAsync(userId, _sharedId, item);
        _db.ChangeTracker.Clear();
        return item;
    }

    private async Task<long> NewUserAsync()
    {
        var user = new User("ko-KR", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<long> NewItemAsync(long userId, string url)
    {
        var saved = await new ItemStore(_db).SaveAsync(userId, url, null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        return saved.Entry.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class SettableTime(DateTimeOffset start) : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = start;

        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class RecordingSender : IPushSender
    {
        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default) =>
            Task.FromResult(PushSendResult.Sent("test-message"));
    }
}
