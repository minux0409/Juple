using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Domain.Notifications;
using Juple.Domain.Push;
using Juple.UnitTests.Collections;

namespace Juple.UnitTests.Push;

public sealed class SocialPushDispatchTests
{
    private static readonly DateTimeOffset Now = new(2026, 9, 27, 12, 0, 0, TimeSpan.Zero);

    private readonly FakeDispatchStore _store = new();
    private readonly FakeDeliveryStore _deliveries = new();
    private readonly FakeDeviceStore _devices = new();
    private readonly FakeSender _sender = new();
    private readonly MutableTimeProvider _time = new(Now);

    private DispatchPendingPushNotificationsService Service() => new(_store, _deliveries, _devices, _sender, _time);

    private static Notification Pending(long id, NotificationType type, DateTimeOffset createdAtUtc, long userId = 5)
    {
        var notification = Notification.Social(userId, type, 9, 42, 77, $"key-{id}", createdAtUtc);
        typeof(Notification).GetProperty(nameof(Notification.Id))!.SetValue(notification, id);
        return notification;
    }

    [Fact]
    public async Task Sends_ToEveryEnabledDevice_ThenMarksDispatched()
    {
        _store.Items.Add(Pending(1, NotificationType.FriendRequestReceived, Now.AddMinutes(-1)));
        _devices.Add(5, 100, "ko");
        _devices.Add(5, 101, "en");

        var result = await Service().RunOnceAsync();

        Assert.Equal(2, result.Sent);
        Assert.Equal(new[] { 100L, 101L }, _sender.Sent.Select(sent => sent.DeviceId));
        Assert.Contains(1L, _store.Dispatched);
    }

    [Fact]
    public async Task NoLongerRelevant_OrNoDevice_IsSkipped_WithoutSending()
    {
        _store.Items.Add(Pending(1, NotificationType.CollectionInvitationReceived, Now.AddMinutes(-1)));
        _store.Irrelevant.Add(1);
        _store.Items.Add(Pending(2, NotificationType.FriendRequestReceived, Now.AddMinutes(-1), userId: 6));
        _devices.Add(5, 100, "ko");

        var result = await Service().RunOnceAsync();

        Assert.Empty(_sender.Sent);
        Assert.Equal(2, result.Skipped);
        Assert.Equal(new[] { 1L, 2L }, _store.Dispatched);
    }

    [Fact]
    public async Task OldNotifications_Expire_VisibleAfterHours_DataOnlyAfterMinutes()
    {
        _store.Items.Add(Pending(1, NotificationType.FriendRequestReceived, Now - SocialNotificationPolicy.VisibleMaxAge - TimeSpan.FromSeconds(1)));
        _store.Items.Add(Pending(2, NotificationType.CollectionContentChanged, Now.AddMinutes(-11)));
        _store.Items.Add(Pending(3, NotificationType.CollectionContentChanged, Now.AddMinutes(-2)));
        _devices.Add(5, 100, "ko");

        var result = await Service().RunOnceAsync();

        Assert.Equal(2, result.Expired);
        Assert.Equal(3L, Assert.Single(_sender.Sent).Payload.NotificationId);
    }

    [Fact]
    public async Task ATransientFailure_StaysPendingForTheNextPass_APermanentOneDisablesTheToken()
    {
        _store.Items.Add(Pending(1, NotificationType.FriendRequestReceived, Now.AddMinutes(-1)));
        _devices.Add(5, 100, "ko");
        _sender.FailWith = PushSendFailureCodes.Unavailable;
        await Service().RunOnceAsync();
        Assert.Empty(_store.Dispatched);
        Assert.Empty(_devices.Disabled);

        _sender.FailWith = PushSendFailureCodes.Unregistered;
        await Service().RunOnceAsync();
        Assert.Equal(new[] { 100L }, _devices.Disabled);
        Assert.Equal(new[] { 1L }, _store.Dispatched);
    }

    [Fact]
    public async Task AClaimHeldElsewhere_IsNeverSentTwice()
    {
        _store.Items.Add(Pending(1, NotificationType.FriendRequestReceived, Now.AddMinutes(-1)));
        _devices.Add(5, 100, "ko");
        _deliveries.Claimed.Add((1, 100));

        await Service().RunOnceAsync();

        Assert.Empty(_sender.Sent);
    }

    [Fact]
    public void Payloads_VisibleOnesCarryTextAndBadge_RefreshSignalsCarryNoText()
    {
        var context = new PushDispatchContext(true, "피카츄", "여행", 3);

        var invite = DispatchPendingPushNotificationsService.BuildPayload(Pending(1, NotificationType.CollectionInvitationReceived, Now), context, "ko");
        Assert.Equal(("컬렉션 공유", "피카츄님이 '여행' 컬렉션을 공유했어요."), (invite.Title, invite.Body));
        Assert.Equal(3, invite.BadgeCount);
        Assert.Equal("collectionInvitation", invite.Type);
        Assert.Equal("42", invite.Data["collectionId"]);

        var refresh = DispatchPendingPushNotificationsService.BuildPayload(Pending(2, NotificationType.CollectionInvitationAnswered, Now), context, "ko");
        Assert.Null(refresh.Title);
        Assert.Null(refresh.Body);
        Assert.Null(refresh.BadgeCount);
        Assert.Equal("77", refresh.Data["invitationId"]);

        var friendAnswered = DispatchPendingPushNotificationsService.BuildPayload(Pending(3, NotificationType.FriendRequestAnswered, Now), context, "ko");
        Assert.Equal("friendRequestAnswered", friendAnswered.Type);
        Assert.Null(friendAnswered.Title);
        Assert.Null(friendAnswered.BadgeCount);
        Assert.False(friendAnswered.Data.ContainsKey("invitationId"));
        Assert.Equal(SocialNotificationPolicy.DataOnlyMaxAge, SocialNotificationPolicy.MaxAge(NotificationType.FriendRequestAnswered));
    }

    [Theory]
    [InlineData("ko", "친구 신청")]
    [InlineData("en", "Friend request")]
    [InlineData("zh-Hant", "好友邀請")]
    [InlineData("zh-TW", "好友申请")]
    [InlineData("pt", "Pedido de amizade")]
    [InlineData("pt-PT", "Pedido de amizade")]
    [InlineData("xx", "Friend request")]
    [InlineData(null, "Friend request")]
    public void PushText_UsesTheDeviceLanguage_WithBaseLanguageAndEnglishFallbacks(string? locale, string title)
    {
        Assert.Equal(title, SocialPushText.For(NotificationType.FriendRequestReceived, locale, "A", "B").Title);
    }

    [Fact]
    public void PushText_CoversEveryAppLanguage_AndAlwaysNamesTheSender()
    {
        foreach (var locale in new[] { "ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi" })
        {
            var friend = SocialPushText.For(NotificationType.FriendRequestReceived, locale, "SENDER", "COLL");
            var invite = SocialPushText.For(NotificationType.CollectionInvitationReceived, locale, "SENDER", "COLL");
            Assert.Contains("SENDER", friend.Body);
            Assert.Contains("SENDER", invite.Body);
            Assert.Contains("COLL", invite.Body);
            Assert.NotEqual(friend.Title, invite.Title);
        }
    }

    [Fact]
    public void NewLinks_AreVisible_NameTheAdder_CountBulkAdds_AndHideAPublicLinkAdder()
    {
        Assert.False(SocialNotificationPolicy.IsDataOnly(NotificationType.CollectionItemsAdded));
        Assert.Equal("collectionItemsAdded", SocialNotificationPolicy.WireType(NotificationType.CollectionItemsAdded));
        Assert.Equal(("새 링크", "피카츄님이 '여행'에 새 링크를 추가했어요."),
            SocialPushText.For(NotificationType.CollectionItemsAdded, "ko", "피카츄", "여행"));
        Assert.Equal("'여행'에 링크 5개가 추가됐어요.", SocialPushText.For(NotificationType.CollectionItemsAdded, "ko", "피카츄", "여행", 5).Body);
        Assert.Equal("'여행' 컬렉션에 새 링크가 추가됐어요.", SocialPushText.For(NotificationType.CollectionItemsAdded, "ko", "", "여행").Body);
        Assert.Equal("'여행'에 공개 링크를 통해 새 링크가 추가됐어요.",
            SocialPushText.For(NotificationType.CollectionItemsAdded, "ko", "", "여행", viaPublicLink: true).Body);

        var context = new PushDispatchContext(true, null, "여행", 0);
        var viaLink = DispatchPendingPushNotificationsService.BuildPayload(
            Notification.Social(9, NotificationType.CollectionItemsAdded, null, 42, null, "k", Now, 1), context, "en");
        Assert.Equal("A new link was added to \"여행\" through its public link.", viaLink.Body);
        Assert.Equal(["collectionId"], viaLink.Data.Keys);
        var bulk = DispatchPendingPushNotificationsService.BuildPayload(
            Notification.Social(9, NotificationType.CollectionItemsAdded, 5, 42, null, "k2", Now, 3), context with { ActorName = "Kim" }, "en");
        Assert.Equal("3 links were added to \"여행\".", bulk.Body);
    }

    [Fact]
    public void NewLinkText_CoversEveryAppLanguage_AndShortensLongCollectionNames()
    {
        foreach (var locale in new[] { "ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi" })
        {
            var by = SocialPushText.For(NotificationType.CollectionItemsAdded, locale, "SENDER", "COLL");
            var many = SocialPushText.For(NotificationType.CollectionItemsAdded, locale, "SENDER", "COLL", 7);
            var hidden = SocialPushText.For(NotificationType.CollectionItemsAdded, locale, "SENDER", "COLL", viaPublicLink: true);
            Assert.Contains("SENDER", by.Body);
            Assert.Contains("COLL", by.Body);
            Assert.Contains("7", many.Body);
            Assert.DoesNotContain("SENDER", hidden.Body);
            Assert.Contains("COLL", hidden.Body);
            Assert.NotEqual(SocialPushText.For(NotificationType.FriendRequestReceived, locale, "A", "B").Title, by.Title);
        }

        var longName = string.Concat(Enumerable.Repeat("가", 60)) + "👍";
        var shortened = SocialPushText.Shorten(longName);
        Assert.Equal(SocialPushText.CollectionNameMaxLength, new System.Globalization.StringInfo(shortened).LengthInTextElements);
        Assert.EndsWith("…", shortened);
        Assert.Equal("짧은 이름", SocialPushText.Shorten("짧은 이름"));
        Assert.Equal("🇰🇷", SocialPushText.Shorten(string.Concat(Enumerable.Repeat("🇰🇷", 50)))[..4]); // never splits a flag/emoji
    }

    [Fact]
    public void NewLinkNotifications_AreOnePerOperation()
    {
        var first = SocialNotificationPolicy.ItemsAddedDedupKey(42, 5, Guid.NewGuid());
        Assert.NotEqual(first, SocialNotificationPolicy.ItemsAddedDedupKey(42, 5, Guid.NewGuid()));
        Assert.True(first.Length <= 120); // UX_Notifications_DedupKey column
        Assert.True(SocialNotificationPolicy.ItemsAddedDedupKey(long.MaxValue, long.MaxValue, Guid.NewGuid()).Length <= 120);
    }

    [Fact]
    public void ContentChanges_AreCoalescedPerRecipientCollectionAndMinute()
    {
        var first = SocialNotificationPolicy.ContentChangeDedupKey(42, 5, Now);
        Assert.Equal(first, SocialNotificationPolicy.ContentChangeDedupKey(42, 5, Now.AddSeconds(30)));
        Assert.NotEqual(first, SocialNotificationPolicy.ContentChangeDedupKey(42, 5, Now.AddSeconds(61)));
        Assert.NotEqual(first, SocialNotificationPolicy.ContentChangeDedupKey(42, 6, Now));
        Assert.NotEqual(first, SocialNotificationPolicy.ContentChangeDedupKey(43, 5, Now));
    }

    private sealed class FakeDispatchStore : IPushDispatchStore
    {
        public List<Notification> Items { get; } = [];

        public HashSet<long> Irrelevant { get; } = [];

        public List<long> Dispatched { get; } = [];

        public Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Notification>>(Items.Where(item => !Dispatched.Contains(item.Id)).ToList());

        public Task<PushDispatchContext> GetContextAsync(Notification notification, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new PushDispatchContext(!Irrelevant.Contains(notification.Id), "Actor", "Collection", 1));

        public Task MarkDispatchedAsync(long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Dispatched.Add(notificationId);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeDeliveryStore : INotificationDeliveryStore
    {
        public HashSet<(long, long)> Claimed { get; } = [];

        public Task<bool> TryClaimAsync(long notificationId, long pushDeviceRegistrationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(Claimed.Add((notificationId, pushDeviceRegistrationId)));

        public Task RecordAttemptAsync(long notificationId, long pushDeviceRegistrationId, NotificationDeliveryStatus status, DateTimeOffset attemptedAtUtc,
            string? providerMessageId, string? failureCode, CancellationToken cancellationToken = default)
        {
            if (status == NotificationDeliveryStatus.Failed)
            {
                Claimed.Remove((notificationId, pushDeviceRegistrationId)); // a Failed row is claimable again
            }

            return Task.CompletedTask;
        }
    }

    private sealed class FakeDeviceStore : IPushDeviceRegistrationStore
    {
        private readonly List<PushDeviceRegistration> _devices = [];

        public List<long> Disabled { get; } = [];

        public void Add(long userId, long id, string locale)
        {
            var device = new PushDeviceRegistration(userId, PushPlatform.Android, Guid.NewGuid().ToString("N"), "token", locale, Now, Now);
            typeof(PushDeviceRegistration).GetProperty(nameof(PushDeviceRegistration.Id))!.SetValue(device, id);
            _devices.Add(device);
        }

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PushDeviceRegistration>>(_devices.Where(device => device.UserId == userId && !Disabled.Contains(device.Id)).ToList());

        public Task DisableByIdAsync(long id, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
        {
            Disabled.Add(id);
            return Task.CompletedTask;
        }

        public Task<PushDeviceRegistrationDto> RegisterAsync(long userId, PushPlatform platform, string installationId, string pushToken, string locale,
            DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task DisableAsync(long userId, string installationId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();
    }

    private sealed class FakeSender : IPushSender
    {
        public List<(long DeviceId, PushNotificationPayload Payload)> Sent { get; } = [];

        public string? FailWith { get; set; }

        public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
        {
            if (FailWith is { } code)
            {
                return Task.FromResult(PushSendResult.Failed(code));
            }

            Sent.Add((device.Id, payload));
            return Task.FromResult(PushSendResult.Sent("id"));
        }
    }
}
