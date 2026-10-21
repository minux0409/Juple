using System.Collections.Concurrent;
using System.Security.Cryptography;
using Juple.Api.Collections;
using Juple.Api.Configuration;
using Juple.Application.Collections.Access;
using Juple.Application.Collections.AddItemToCollection;
using Juple.Application.Collections.Collaboration;
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
/// One recipient with an Android phone AND an iPhone, through the real outbox and dispatch pipeline and the production router
/// (PlatformPushSender) with scripted FCM / APNs transports: each device gets the same notification once, only a failed device is
/// retried, a dead APNs token disables only that iPhone, and an APNs failure or crash never stops the Android delivery.
/// </summary>
public sealed class MixedPlatformPushIntegrationTests : IAsyncLifetime
{
    private JupleDbContext _db = null!;
    private readonly List<long> _userIds = [];
    private long _owner;
    private long _member;
    private long _sharedId;
    private long _memberAndroidId;
    private long _memberIphoneId;
    private AddItemToCollectionService _addItem = null!;
    private readonly ScriptedSender _fcm = new();
    private readonly ScriptedSender _apns = new();

    public async Task InitializeAsync()
    {
        var connectionString = Environment.GetEnvironmentVariable("ConnectionStrings__JupleDatabase")
            ?? throw new InvalidOperationException("ConnectionStrings__JupleDatabase must be set.");
        _db = new JupleDbContext(new DbContextOptionsBuilder<JupleDbContext>().UseSqlServer(connectionString).Options);
        _owner = await NewUserAsync();
        _member = await NewUserAsync();

        var publisher = new SocialNotificationPublisher(_db, TimeProvider.System, NullLogger<SocialNotificationPublisher>.Instance);
        var access = new CollectionAccessService(new CollectionAccessStore(_db), new CollectionUnlockTokenProtector(Options.Create(new CollectionUnlockGrantOptions
        {
            EncryptionKey = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)),
        })), TimeProvider.System);
        var collections = new CollectionStore(_db);
        var collaboration = new CollectionCollaborationService(access, new UserDirectoryStore(_db), new CollectionCollaborationStore(_db), TimeProvider.System, publisher);
        _addItem = new AddItemToCollectionService(access, collections, TimeProvider.System, publisher);

        _sharedId = (await collections.CreateAsync(_owner, "Trips", "TRIPS", CollectionIcon.Folder, DateTimeOffset.UtcNow)).Id;
        var invitation = await collaboration.InviteAsync(_owner, _sharedId, await JupleIdOfAsync(_member), CollectionCollaboratorRole.Viewer);
        await collaboration.AcceptInvitationAsync(_member, invitation.InvitationId);

        // The actor has both kinds of device too: neither may get its own notification.
        await RegisterAsync(_owner, PushPlatform.Android, "fcm-owner-" + Guid.NewGuid().ToString("N"));
        await RegisterAsync(_owner, PushPlatform.Ios, ApnsToken());
        _memberAndroidId = await RegisterAsync(_member, PushPlatform.Android, "fcm-member-" + Guid.NewGuid().ToString("N"));
        _memberIphoneId = await RegisterAsync(_member, PushPlatform.Ios, ApnsToken(), ApnsEnvironment.Development);
        await Dispatcher().RunOnceAsync(); // the invitation's own pushes are not what these tests look at
        _fcm.Clear();
        _apns.Clear();
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
    public async Task OneNotification_ReachesTheAndroidPhoneAndTheIphoneOnce_WithTheSamePayload_AndNeverTheActor()
    {
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();
        await Dispatcher().RunOnceAsync(); // a second pass sends nothing again

        var android = Assert.Single(Visible(_fcm));
        var iphone = Assert.Single(Visible(_apns));
        Assert.Equal((_memberAndroidId, PushPlatform.Android), (android.Device.Id, android.Device.Platform));
        Assert.Equal((_memberIphoneId, PushPlatform.Ios, ApnsEnvironment.Development), (iphone.Device.Id, iphone.Device.Platform, iphone.Device.ApnsEnvironment!.Value));
        Assert.Equal((android.Payload.Type, android.Payload.Title, android.Payload.Body, android.Payload.NotificationId), (iphone.Payload.Type, iphone.Payload.Title, iphone.Payload.Body, iphone.Payload.NotificationId));
        Assert.Equal(android.Payload.Data, iphone.Payload.Data);
        Assert.NotNull(iphone.Payload.ExpiresAtUtc);
        Assert.DoesNotContain(_fcm.Sent.Concat(_apns.Sent), sent => sent.Device.UserId == _owner);
    }

    [Fact]
    public async Task AnApnsOutage_IsRetriedForTheIphoneOnly_AndAndroidIsNotSentTwice()
    {
        _apns.Next = PushSendResult.Failed(PushSendFailureCodes.Unavailable);
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();
        Assert.Single(Visible(_fcm));
        // The recovery sweep may already retry within the same pass (no grace period in the test kit) - every attempt failed.
        var failedAttempts = Visible(_apns).Count;
        Assert.True(failedAttempts >= 1);
        Assert.Equal(NotificationDeliveryStatus.Failed, (await DeliveriesAsync())[_memberIphoneId].Status);

        _apns.Next = PushSendResult.Sent("apns-ok");
        await Dispatcher().RunOnceAsync();
        await Dispatcher().RunOnceAsync(); // delivered: nothing is sent again

        Assert.Single(Visible(_fcm));
        Assert.Equal(failedAttempts + 1, Visible(_apns).Count);
        var deliveries = await DeliveriesAsync();
        Assert.Equal((NotificationDeliveryStatus.Sent, 1), (deliveries[_memberAndroidId].Status, deliveries[_memberAndroidId].AttemptCount));
        Assert.Equal((NotificationDeliveryStatus.Sent, failedAttempts + 1), (deliveries[_memberIphoneId].Status, deliveries[_memberIphoneId].AttemptCount));
    }

    [Fact]
    public async Task ADeadApnsToken_DisablesOnlyThatIphone()
    {
        _apns.Next = PushSendResult.Failed(PushSendFailureCodes.BadDeviceToken);
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();
        // The first push to reach the iPhone (the data-only refresh or the visible one) disables it; nothing is sent to it afterwards.
        var apnsAttempts = _apns.Sent.Count;
        Assert.True(apnsAttempts >= 1);
        await Dispatcher().RunOnceAsync();
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();

        Assert.Equal(apnsAttempts, _apns.Sent.Count);
        Assert.Equal(2, Visible(_fcm).Count); // both links reached the Android phone
        var devices = await _db.PushDeviceRegistrations.AsNoTracking().Where(device => device.UserId == _member).ToDictionaryAsync(device => device.Id, device => device.IsEnabled);
        Assert.True(devices[_memberAndroidId]);
        Assert.False(devices[_memberIphoneId]);
    }

    [Fact]
    public async Task AnApnsCrash_IsAFailedIphoneAttempt_AndTheAndroidPushStillGoesOut()
    {
        _apns.Throw = true;
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();

        Assert.Single(Visible(_fcm));
        var deliveries = await DeliveriesAsync();
        Assert.Equal(NotificationDeliveryStatus.Sent, deliveries[_memberAndroidId].Status);
        Assert.Equal((NotificationDeliveryStatus.Failed, PushSendFailureCodes.UnknownError), (deliveries[_memberIphoneId].Status, deliveries[_memberIphoneId].FailureCode));
    }

    [Fact]
    public async Task APersistentApnsAuthFailure_KeepsTheIphoneEnabled_IsRetriedOnlyUntilTheNotificationExpires_AndAndroidIsSentOnce()
    {
        _apns.Next = PushSendResult.Failed(PushSendFailureCodes.ThirdPartyAuthError);
        await OwnerAddsALinkAsync();
        await Dispatcher().RunOnceAsync();
        await Dispatcher().RunOnceAsync();
        var attemptsWhileLive = Visible(_apns).Count;
        Assert.True(attemptsWhileLive >= 1);
        Assert.Single(Visible(_fcm));

        // Past the visible notification's MaxAge (6 h) the recovery Job closes it as expired: no further attempt, ever.
        var later = new LaterTime(DateTimeOffset.UtcNow + SocialNotificationPolicy.VisibleMaxAge + TimeSpan.FromMinutes(1));
        await NotificationPipelineTestKit.Dispatcher(_db, new PlatformPushSender(_fcm, _apns, NullLogger<PlatformPushSender>.Instance), later).RunOnceAsync();
        await NotificationPipelineTestKit.Dispatcher(_db, new PlatformPushSender(_fcm, _apns, NullLogger<PlatformPushSender>.Instance), later).RunOnceAsync();

        Assert.Equal(attemptsWhileLive, Visible(_apns).Count);
        Assert.Single(Visible(_fcm));
        Assert.True(await _db.PushDeviceRegistrations.AsNoTracking().Where(device => device.Id == _memberIphoneId).Select(device => device.IsEnabled).SingleAsync());
        var undispatched = await _db.Notifications.AsNoTracking()
            .CountAsync(notification => notification.UserId == _member && notification.Type == NotificationType.CollectionItemsAdded && notification.DispatchedAtUtc == null);
        Assert.Equal(0, undispatched);
    }

    [Fact]
    public async Task WithoutAnApnsKey_AndroidIsDeliveredAsBefore_AndTheIphoneWaits()
    {
        await OwnerAddsALinkAsync();
        var notConfigured = new PlatformPushSender(_fcm, new NotConfiguredPushSender(), NullLogger<PlatformPushSender>.Instance);
        await NotificationPipelineTestKit.Dispatcher(_db, notConfigured).RunOnceAsync();

        Assert.Single(Visible(_fcm));
        var deliveries = await DeliveriesAsync();
        Assert.Equal((NotificationDeliveryStatus.Failed, PushSendFailureCodes.TransportNotConfigured), (deliveries[_memberIphoneId].Status, deliveries[_memberIphoneId].FailureCode));
        Assert.True(await _db.PushDeviceRegistrations.AsNoTracking().Where(device => device.Id == _memberIphoneId).Select(device => device.IsEnabled).SingleAsync());
    }

    // ---------- helpers ----------

    /// <summary>The visible "new link" pushes; an add also sends members a data-only content-changed refresh, which is not what these tests count.</summary>
    private static IReadOnlyList<(PushDeviceRegistration Device, PushNotificationPayload Payload)> Visible(ScriptedSender sender) =>
        sender.Sent.Where(sent => sent.Payload.Type == "collectionItemsAdded").ToList();

    private DispatchPendingPushNotificationsService Dispatcher() =>
        NotificationPipelineTestKit.Dispatcher(_db, new PlatformPushSender(_fcm, _apns, NullLogger<PlatformPushSender>.Instance));

    private async Task OwnerAddsALinkAsync()
    {
        var saved = await new ItemStore(_db).SaveAsync(_owner, "https://example.test/" + Guid.NewGuid().ToString("N"), null, DateTimeOffset.UtcNow);
        _db.ChangeTracker.Clear();
        await _addItem.AddAsync(_owner, _sharedId, saved.Entry.Id);
        _db.ChangeTracker.Clear();
    }

    private async Task<Dictionary<long, NotificationDelivery>> DeliveriesAsync()
    {
        _db.ChangeTracker.Clear();
        var notificationIds = await _db.Notifications.AsNoTracking()
            .Where(notification => notification.UserId == _member && notification.Type == NotificationType.CollectionItemsAdded)
            .Select(notification => notification.Id)
            .ToListAsync();
        return await _db.NotificationDeliveries.AsNoTracking()
            .Where(delivery => notificationIds.Contains(delivery.NotificationId))
            .ToDictionaryAsync(delivery => delivery.PushDeviceRegistrationId);
    }

    private async Task<long> RegisterAsync(long userId, PushPlatform platform, string token, ApnsEnvironment? environment = null)
    {
        var registered = await new PushDeviceRegistrationStore(_db).RegisterAsync(
            userId, platform, Guid.NewGuid().ToString("N"), token, "ko", DateTimeOffset.UtcNow, platform == PushPlatform.Ios ? environment ?? ApnsEnvironment.Production : null);
        _db.ChangeTracker.Clear();
        return registered.Id;
    }

    private static string ApnsToken() => Convert.ToHexStringLower(RandomNumberGenerator.GetBytes(32));

    private async Task<long> NewUserAsync()
    {
        var user = new User("en-US", "UTC", null, DateTimeOffset.UtcNow, DateTimeOffset.UtcNow);
        _db.Users.Add(user);
        await _db.SaveChangesAsync();
        _userIds.Add(user.Id);
        return user.Id;
    }

    private async Task<string> JupleIdOfAsync(long userId) =>
        await _db.Users.AsNoTracking().Where(user => user.Id == userId).Select(user => user.PublicCode).SingleAsync();

    private sealed class LaterTime(DateTimeOffset now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => now;
    }

    private sealed class ScriptedSender : IPushSender
    {
        private readonly ConcurrentQueue<(PushDeviceRegistration Device, PushNotificationPayload Payload)> sent = new();

        public PushSendResult Next { get; set; } = PushSendResult.Sent("ok");

        public bool Throw { get; set; }

        public IReadOnlyList<(PushDeviceRegistration Device, PushNotificationPayload Payload)> Sent => [.. sent];

        public void Clear()
        {
            sent.Clear();
            Next = PushSendResult.Sent("ok");
            Throw = false;
        }

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            sent.Enqueue((device, payload));
            return Throw ? throw new InvalidOperationException("transport crashed") : Task.FromResult(Next);
        }
    }
}
