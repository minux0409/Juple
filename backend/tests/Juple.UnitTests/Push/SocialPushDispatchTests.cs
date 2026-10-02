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

    private readonly FakeEventStore _events = new();
    private readonly FakeDeliveryQueue _queue = new();

    // Grace 0 (everything is due), one send at a time (deterministic order).
    private readonly NotificationPipelineOptions _options = new() { RecoveryGraceSeconds = 0, MaxConcurrentSends = 1, DeliveryBatchSize = 2 };

    private PushDeliveryProcessor Delivery() => new(_store, _deliveries, _devices, _sender, _time, _options);

    private NotificationEventProcessor Processor(IPushDeliveryQueue? queue = null) => new(_events, Delivery(), _time, _options, queue);

    private DispatchPendingPushNotificationsService Service() => new(_events, Processor(_queue), _store, Delivery(), _time, _options);

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
    public async Task ABatch_IsDecidedWithOneContextAndOneDeviceQuery_NotOnePerNotification()
    {
        for (var id = 1; id <= 6; id++)
        {
            _store.Items.Add(Pending(id, NotificationType.FriendRequestReceived, Now.AddMinutes(-1), userId: 100 + id));
            _devices.Add(100 + id, 1000 + id, "ko");
        }

        var result = await Delivery().DeliverAsync([1, 2, 3, 4, 5, 6]);

        Assert.Equal(6, result.Sent);
        // DeliveryBatchSize 2: three batches - one context and one device query each.
        Assert.Equal(3, _store.ContextCalls);
        Assert.Equal(3, _devices.BatchQueries);
    }

    [Fact]
    public async Task TheRecoveryRun_ProcessesALostEventItself_AndDeliversItsNotificationsDirectly()
    {
        _store.Items.Add(Pending(7, NotificationType.FriendRequestReceived, Now.AddMinutes(-1)));
        _devices.Add(5, 100, "ko");
        _events.Recoverable.Add(70);
        _events.Pages[70] = new Queue<MaterializedPage>([new MaterializedPage([7], true, [])]);

        var result = await Service().RunOnceAsync();

        Assert.Equal(1, result.EventsRecovered);
        Assert.Equal(7L, Assert.Single(_sender.Sent).Payload.NotificationId);
        Assert.Empty(_queue.Queued); // the recovery path never relies on Service Bus
    }

    [Fact]
    public async Task TheWorker_QueuesEachPageInBatches_AndDeliversItselfWhenTheQueueIsUnreachable()
    {
        foreach (var id in new long[] { 1, 2, 3 })
        {
            _store.Items.Add(Pending(id, NotificationType.CollectionItemsAdded, Now, userId: 10 + id));
            _devices.Add(10 + id, 100 + id, "ko");
        }

        _events.Pages[80] = new Queue<MaterializedPage>([new MaterializedPage([1, 2, 3], false, []), new MaterializedPage([], true, [])]);
        var outcome = await Processor(_queue).ProcessAsync(80, deliverInline: false);

        Assert.True(outcome.Processed);
        Assert.Equal(2, outcome.Pages);
        Assert.Equal([[1L, 2L], [3L]], _queue.Queued.Select(batch => batch.ToArray()).ToArray());
        Assert.Empty(_sender.Sent); // handed over, not sent here

        _queue.Available = false;
        _events.Pages[81] = new Queue<MaterializedPage>([new MaterializedPage([1, 2, 3], true, [])]);
        await Processor(_queue).ProcessAsync(81, deliverInline: false);
        Assert.Equal(3, _sender.Sent.Count);
    }

    [Fact]
    public async Task AnEventAnotherProcessorHolds_IsLeftAlone_AndAFailedOneIsRescheduled_NotGivenUp()
    {
        _events.Pages[90] = new Queue<MaterializedPage>([new MaterializedPage([1], true, [])]);
        _events.HeldElsewhere.Add(90);
        var outcome = await Processor(_queue).ProcessAsync(90, deliverInline: false);
        Assert.False(outcome.Processed);
        Assert.Empty(_queue.Queued);

        _events.HeldElsewhere.Clear();
        _events.FailOnPage = new TimeoutException();
        var retry = await Assert.ThrowsAsync<NotificationEventRetryScheduledException>(() => Processor(_queue).ProcessAsync(90, deliverInline: false));
        Assert.IsType<TimeoutException>(retry.InnerException);
        var scheduled = Assert.Single(_events.Retries);
        Assert.Equal((90L, nameof(TimeoutException)), (scheduled.EventId, scheduled.Error));
        // A: first failure - retry in RetryBaseDelaySeconds, not flagged, not permanent.
        Assert.Equal(Now + TimeSpan.FromSeconds(_options.RetryBaseDelaySeconds), scheduled.NextAttemptAtUtc);
        Assert.False(scheduled.RequiresAttention);
    }

    [Fact]
    public async Task B_RepeatedTransientFailures_PastTheOldEightAttemptLimit_StayRetryable_WithACappedBackOff()
    {
        _events.Pages[91] = new Queue<MaterializedPage>([new MaterializedPage([1], true, [])]);
        _events.FailOnPage = new TimeoutException();

        for (var attempt = 1; attempt <= 30; attempt++)
        {
            await Assert.ThrowsAsync<NotificationEventRetryScheduledException>(() => Processor(_queue).ProcessAsync(91, deliverInline: false));
        }

        Assert.Equal(30, _events.Retries.Count); // every attempt rescheduled - never given up
        Assert.All(_events.Retries.Take(_options.AttentionAfterAttempts - 1), retry => Assert.False(retry.RequiresAttention));
        Assert.All(_events.Retries.Skip(_options.AttentionAfterAttempts - 1), retry => Assert.True(retry.RequiresAttention));
        Assert.Equal(Now + TimeSpan.FromSeconds(_options.RetryMaxDelaySeconds), _events.Retries[^1].NextAttemptAtUtc); // capped

        // Once the cause is gone, the very same event is processed normally.
        _events.FailOnPage = null;
        Assert.True((await Processor(_queue).ProcessAsync(91, deliverInline: false)).Processed);
    }

    [Theory]
    [InlineData(1, 5)]
    [InlineData(2, 10)]
    [InlineData(4, 40)]
    [InlineData(7, 300)]
    [InlineData(50, 300)]
    public void TheBackOff_DoublesFromTheBase_AndIsCapped(int attempt, int expectedSeconds) =>
        Assert.Equal(TimeSpan.FromSeconds(expectedSeconds), NotificationRetryPolicy.DelayAfter(attempt, new NotificationPipelineOptions()));

    [Fact]
    public async Task C_AMalformedEvent_IsReportedAsPermanent()
    {
        _events.Pages[92] = new Queue<MaterializedPage>([new MaterializedPage([], true, [], "MalformedEvent")]);

        var outcome = await Processor(_queue).ProcessAsync(92, deliverInline: false);

        Assert.Equal("MalformedEvent", outcome.PermanentFailureCode);
        Assert.Empty(_events.Retries);
    }

    [Fact]
    public async Task TheRecoveryRun_KeepsGoing_WhenOneEventFails_AndCountsItsScheduledRetry()
    {
        _store.Items.Add(Pending(7, NotificationType.FriendRequestReceived, Now.AddMinutes(-1)));
        _devices.Add(5, 100, "ko");
        _events.Pages[93] = new Queue<MaterializedPage>([new MaterializedPage([7], true, [])]);
        _events.Recoverable.AddRange([94, 93]); // 94 fails: it has no pages (throws in the fake)
        _events.Pages[94] = null!;

        var result = await Service().RunOnceAsync();

        Assert.Equal(1, result.EventsRecovered);
        Assert.Equal(1, result.EventRetriesScheduled);
        Assert.Equal(7L, Assert.Single(_sender.Sent).Payload.NotificationId);
    }

    [Fact]
    public async Task AnItemWideEvent_ProcessesTheChildEventsItExpandedInto()
    {
        _events.Pages[100] = new Queue<MaterializedPage>([new MaterializedPage([], true, [101, 102])]);
        _events.Pages[101] = new Queue<MaterializedPage>([new MaterializedPage([1], true, [])]);
        _events.Pages[102] = new Queue<MaterializedPage>([new MaterializedPage([2], true, [])]);

        var outcome = await Processor(_queue).ProcessAsync(100, deliverInline: false);

        Assert.Equal(2, outcome.Children);
        Assert.Equal(2, outcome.Materialized);
        Assert.Equal([[1L], [2L]], _queue.Queued.Select(batch => batch.ToArray()).ToArray());
    }

    [Theory]
    [InlineData("1,2,3", new long[] { 1, 2, 3 })]
    [InlineData(" 7 ", new long[] { 7 })]
    [InlineData("", null)]
    [InlineData("1,-2", null)]
    [InlineData("1,x", null)]
    [InlineData("1;2", null)]
    public void ADeliveriesMessage_IsOnlyEverAListOfPositiveIds(string body, long[]? expected) =>
        Assert.Equal(expected, Juple.Infrastructure.Notifications.ServiceBusNotificationConsumer.ParseIds(body)?.ToArray());

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

    [Fact]
    public void ALinkPassedOn_IsVisible_AndCarriesOnlyThePublicLinkId_NeverTheInternalCollectionId()
    {
        var context = new PushDispatchContext(true, "피카츄", "여행", 0, PublicShareId: "pub123");

        var payload = DispatchPendingPushNotificationsService.BuildPayload(Pending(1, NotificationType.CollectionLinkShared, Now), context, "ko");

        Assert.Equal("collectionLinkShared", payload.Type);
        Assert.Equal(("컬렉션 링크", "피카츄님이 '여행' 컬렉션 링크를 보냈어요."), (payload.Title, payload.Body));
        Assert.Equal("pub123", payload.Data["publicId"]);
        Assert.False(payload.Data.ContainsKey("collectionId"));
        Assert.False(SocialNotificationPolicy.IsDataOnly(NotificationType.CollectionLinkShared));
        Assert.Equal(("Collection link", "피카츄 sent you a link to the collection \"여행\"."),
            SocialPushText.For(NotificationType.CollectionLinkShared, "en", "피카츄", "여행"));
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

    [Theory]
    [InlineData(NotificationType.CollectionItemReactionReceived, "collectionItemReaction", 8)]
    [InlineData(NotificationType.CollectionItemCommentReceived, "collectionItemComment", 9)]
    [InlineData(NotificationType.CollectionLinkSubmissionReceived, "collectionLinkSubmission", 10)]
    [InlineData(NotificationType.CollectionLinkSubmissionApproved, "collectionLinkSubmissionApproved", 11)]
    [InlineData(NotificationType.CollectionLinkSubmissionRejected, "collectionLinkSubmissionRejected", 12)]
    public void CollaborationTypes_AreAppendedVisibleTypes_WithStableWireNames(NotificationType type, string wire, byte value)
    {
        Assert.Equal(value, (byte)type);
        Assert.Equal(wire, SocialNotificationPolicy.WireType(type));
        Assert.False(SocialNotificationPolicy.IsDataOnly(type));
        Assert.Equal(SocialNotificationPolicy.VisibleMaxAge, SocialNotificationPolicy.MaxAge(type));
        // The existing values never move.
        Assert.Equal(7, (byte)NotificationType.CollectionLinkShared);
        Assert.Equal(6, (byte)NotificationType.CollectionItemsAdded);
    }

    [Fact]
    public void AReactionOrComment_NamesWhoAndWhere_OpensTheCollection_AndCarriesNothingElse()
    {
        var context = new PushDispatchContext(true, "피카츄", "여행", 2);

        var reaction = DispatchPendingPushNotificationsService.BuildPayload(Pending(1, NotificationType.CollectionItemReactionReceived, Now), context, "ko");
        var comment = DispatchPendingPushNotificationsService.BuildPayload(Pending(2, NotificationType.CollectionItemCommentReceived, Now), context, "ko");

        Assert.Equal(("새 반응", "피카츄님이 '여행'에 있는 내 링크에 반응을 남겼어요."), (reaction.Title, reaction.Body));
        Assert.Equal(("새 댓글", "피카츄님이 '여행'에 있는 내 링크에 댓글을 남겼어요."), (comment.Title, comment.Body));
        // Only the Collection to open - never the Item id (SubjectId 77), the actor id or anything of the link.
        Assert.Equal(["collectionId"], reaction.Data.Keys);
        Assert.Equal("42", reaction.Data["collectionId"]);
        Assert.Equal(["collectionId"], comment.Data.Keys);
        Assert.DoesNotContain(reaction.Data.Values, value => value is "77" or "9");
    }

    [Fact]
    public void AProposal_TellsTheOwner_WithoutNamingWhoProposed()
    {
        // The row never carries an actor; even a context with a name must not put it in the text.
        var context = new PushDispatchContext(true, "SENDER", "여행", 0);
        var notification = Notification.Social(5, NotificationType.CollectionLinkSubmissionReceived, null, 42, 77, "k", Now);

        var payload = DispatchPendingPushNotificationsService.BuildPayload(notification, context, "ko");

        Assert.Equal(("승인 요청", "'여행'에 승인을 기다리는 새 링크가 있어요."), (payload.Title, payload.Body));
        Assert.Equal(["collectionId"], payload.Data.Keys);
        Assert.Equal("collectionLinkSubmission", payload.Type);
    }

    [Fact]
    public void AProposalResult_OpensTheCollectionForAMember_ThePublicLinkForSomeoneElse_OrNothing()
    {
        var approved = Notification.Social(5, NotificationType.CollectionLinkSubmissionApproved, null, 42, 77, "a", Now);
        var rejected = Notification.Social(5, NotificationType.CollectionLinkSubmissionRejected, null, 42, 77, "r", Now);

        var member = DispatchPendingPushNotificationsService.BuildPayload(approved, new PushDispatchContext(true, null, "여행", 0, "pub1", RecipientBelongs: true), "ko");
        Assert.Equal(("링크 승인", "'여행'에 보낸 링크가 승인됐어요."), (member.Title, member.Body));
        Assert.Equal(["collectionId"], member.Data.Keys);

        var outsider = DispatchPendingPushNotificationsService.BuildPayload(rejected, new PushDispatchContext(true, null, "여행", 0, "pub1", RecipientBelongs: false), "ko");
        Assert.Equal(("링크 미승인", "'여행'에 보낸 링크가 승인되지 않았어요."), (outsider.Title, outsider.Body));
        Assert.Equal(["publicId"], outsider.Data.Keys);
        Assert.Equal("pub1", outsider.Data["publicId"]);

        // Someone else, and the public link is off: the push opens the app, nothing more.
        var nowhere = DispatchPendingPushNotificationsService.BuildPayload(rejected, new PushDispatchContext(true, null, "여행", 0, null, RecipientBelongs: false), "en");
        Assert.Empty(nowhere.Data);
        Assert.Equal("The link you sent to \"여행\" was not approved.", nowhere.Body);
    }

    [Fact]
    public void CollaborationText_CoversEveryAppLanguage_NamesOnlyWhereItShould_AndShortensNames()
    {
        var longName = string.Concat(Enumerable.Repeat("가", 60));
        foreach (var locale in new[] { "ko", "en", "ja", "zh-Hans", "zh-Hant", "es", "fr", "de", "it", "pt-BR", "vi", "th", "id", "ru", "tr", "ar", "hi" })
        {
            var titles = new HashSet<string>();
            foreach (var type in new[]
                     {
                         NotificationType.CollectionItemReactionReceived, NotificationType.CollectionItemCommentReceived,
                         NotificationType.CollectionLinkSubmissionReceived, NotificationType.CollectionLinkSubmissionApproved,
                         NotificationType.CollectionLinkSubmissionRejected,
                     })
            {
                var (title, body) = SocialPushText.For(type, locale, "SENDER", "COLL");
                Assert.False(string.IsNullOrWhiteSpace(title));
                Assert.Contains("COLL", body);
                Assert.DoesNotContain("{", body);
                Assert.True(titles.Add(title), $"{locale}: {type} shares its title");
                var named = type is NotificationType.CollectionItemReactionReceived or NotificationType.CollectionItemCommentReceived;
                Assert.Equal(named, body.Contains("SENDER", StringComparison.Ordinal));
                Assert.DoesNotContain(longName, SocialPushText.For(type, locale, "SENDER", longName).Body);
            }
        }
    }

    [Fact]
    public void ReactionsAndComments_AreCoalescedPerActorLinkAndMinute_AndNeverShareAKey()
    {
        var first = SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemReactionReceived, 42, 7, 5, Now);
        Assert.Equal(first, SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemReactionReceived, 42, 7, 5, Now.AddSeconds(30)));
        Assert.NotEqual(first, SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemReactionReceived, 42, 7, 5, Now.AddSeconds(61)));
        Assert.NotEqual(first, SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemReactionReceived, 42, 7, 6, Now));
        Assert.NotEqual(first, SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemReactionReceived, 42, 8, 5, Now));
        Assert.NotEqual(first, SocialNotificationPolicy.CollaborationDedupKey(NotificationType.CollectionItemCommentReceived, 42, 7, 5, Now));
        Assert.True(SocialNotificationPolicy.CollaborationDedupKey(
            NotificationType.CollectionItemCommentReceived, long.MaxValue, long.MaxValue, long.MaxValue, Now).Length <= 120);
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

        public int ContextCalls { get; private set; }

        public Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, DateTimeOffset createdBefore, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Notification>>(Items.Where(item => !Dispatched.Contains(item.Id) && item.CreatedAtUtc < createdBefore).Take(limit).ToList());

        public Task<IReadOnlyList<Notification>> ListUndispatchedAsync(IReadOnlyCollection<long> notificationIds, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Notification>>(Items.Where(item => notificationIds.Contains(item.Id) && !Dispatched.Contains(item.Id)).ToList());

        public Task<IReadOnlyDictionary<long, PushDispatchContext>> GetContextsAsync(
            IReadOnlyList<Notification> notifications, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            ContextCalls++;
            return Task.FromResult<IReadOnlyDictionary<long, PushDispatchContext>>(notifications.ToDictionary(
                notification => notification.Id, notification => new PushDispatchContext(!Irrelevant.Contains(notification.Id), "Actor", "Collection", 1)));
        }

        public Task MarkDispatchedAsync(IReadOnlyCollection<long> notificationIds, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
        {
            Dispatched.AddRange(notificationIds.OrderBy(id => id));
            return Task.CompletedTask;
        }
    }

    private sealed class FakeEventStore : INotificationEventStore
    {
        public List<long> Recoverable { get; } = [];

        public HashSet<long> HeldElsewhere { get; } = [];

        /// <summary>Per event id: the pages MaterializeNextPageAsync hands out, in order.</summary>
        public Dictionary<long, Queue<MaterializedPage>> Pages { get; } = [];

        public List<(long EventId, string Error, DateTimeOffset NextAttemptAtUtc, bool RequiresAttention)> Retries { get; } = [];

        public Dictionary<long, int> Attempts { get; } = [];

        public Exception? FailOnPage { get; set; }

        public Task<int?> TryClaimAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
        {
            if (HeldElsewhere.Contains(eventId) || !Pages.ContainsKey(eventId))
            {
                return Task.FromResult<int?>(null);
            }

            Attempts[eventId] = Attempts.GetValueOrDefault(eventId) + 1;
            return Task.FromResult<int?>(Attempts[eventId]);
        }

        public Task<MaterializedPage> MaterializeNextPageAsync(long eventId, int pageSize, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default)
        {
            if (FailOnPage is { } failure)
            {
                throw failure;
            }

            return Task.FromResult(Pages[eventId].TryDequeue(out var page) ? page : new MaterializedPage([], true, []));
        }

        public Task ScheduleRetryAsync(long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool requiresAttention, CancellationToken cancellationToken = default)
        {
            Retries.Add((eventId, errorCode, nextAttemptAtUtc, requiresAttention));
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<long>> ListRecoverableAsync(int limit, DateTimeOffset createdBefore, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<long>>(Recoverable.Take(limit).ToList());

        public Task<int> DeleteCompletedBeforeAsync(DateTimeOffset cutoff, int limit, CancellationToken cancellationToken = default) => Task.FromResult(0);

        public Task<NotificationOutboxStats> GetStatsAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(new NotificationOutboxStats(0, null, 0, null));
    }

    private sealed class FakeDeliveryQueue : IPushDeliveryQueue
    {
        public bool Available { get; set; } = true;

        public List<IReadOnlyList<long>> Queued { get; } = [];

        public Task<bool> TryEnqueueAsync(IReadOnlyList<long> notificationIds, CancellationToken cancellationToken = default)
        {
            if (Available)
            {
                Queued.Add(notificationIds);
            }

            return Task.FromResult(Available);
        }
    }

    private sealed class FakeDeliveryStore : INotificationDeliveryStore
    {
        public HashSet<(long, long)> Claimed { get; } = [];

        public Task<bool> TryClaimAsync(long notificationId, long pushDeviceRegistrationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(Claimed.Add((notificationId, pushDeviceRegistrationId)));

        public Task<IReadOnlySet<DeliveryKey>> TryClaimManyAsync(IReadOnlyCollection<DeliveryKey> deliveries, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlySet<DeliveryKey>>(deliveries.Where(key => Claimed.Add((key.NotificationId, key.PushDeviceRegistrationId))).ToHashSet());

        public async Task RecordAttemptsAsync(IReadOnlyCollection<DeliveryAttempt> attempts, CancellationToken cancellationToken = default)
        {
            foreach (var attempt in attempts)
            {
                await RecordAttemptAsync(
                    attempt.Key.NotificationId, attempt.Key.PushDeviceRegistrationId, attempt.Status, attempt.AttemptedAtUtc, attempt.ProviderMessageId, attempt.FailureCode, cancellationToken);
            }
        }

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

        public int BatchQueries { get; private set; }

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<PushDeviceRegistration>>(_devices.Where(device => device.UserId == userId && !Disabled.Contains(device.Id)).ToList());

        public Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledForUsersAsync(IReadOnlyCollection<long> userIds, CancellationToken cancellationToken = default)
        {
            BatchQueries++;
            return Task.FromResult<IReadOnlyList<PushDeviceRegistration>>(_devices.Where(device => userIds.Contains(device.UserId) && !Disabled.Contains(device.Id)).ToList());
        }

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
