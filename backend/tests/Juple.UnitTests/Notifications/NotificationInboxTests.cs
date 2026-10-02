using System.Text.Json;
using Juple.Application.Notifications;
using Juple.Application.Notifications.Inbox;
using Juple.Application.Push;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Push;

namespace Juple.UnitTests.Notifications;

/// <summary>
/// The Inbox's one canonical mapping (NotificationInboxPolicy.ResolveTarget) for every Type, its safe
/// fallbacks, and what a row may show (NotificationInboxService) - against a fake store.
/// </summary>
public sealed class NotificationInboxTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 2, 12, 0, 0, TimeSpan.Zero);
    private static readonly NotificationInboxActor Kim = new(31, "ABCDEFGH", "Kim", "users/31/profile/a.jpg");

    private static NotificationInboxRecord Record(
        NotificationType type,
        bool live = true,
        bool owner = false,
        bool belongs = true,
        string? publicId = null,
        bool linkStillOwn = true,
        bool invitationPending = false,
        NotificationInboxActor? actor = null,
        bool actorHidden = false,
        long id = 1,
        DateTimeOffset? readAtUtc = null) =>
        new(id, type, Now, readAtUtc, 1, 42, 77, actorHidden, actor ?? (actorHidden ? null : Kim),
            live && (belongs || invitationPending || publicId is not null) ? "여행" : null,
            live, owner && live, (belongs || owner) && live, live ? publicId : null, linkStillOwn, invitationPending);

    public static TheoryData<NotificationType, string, long?, long?, string?, string?> Targets() => new()
    {
        { NotificationType.FriendRequestReceived, NotificationTargetKinds.FriendRequests, null, null, null, null },
        { NotificationType.CollectionItemsAdded, NotificationTargetKinds.Collection, 42, null, null, null },
        { NotificationType.CollectionItemReactionReceived, NotificationTargetKinds.CollectionItem, 42, 77, null, null },
        { NotificationType.CollectionItemCommentReceived, NotificationTargetKinds.CollectionItem, 42, 77, null, NotificationTargetFocus.Comments },
        { NotificationType.CollectionLinkSubmissionApproved, NotificationTargetKinds.Collection, 42, null, null, null },
        { NotificationType.CollectionLinkSubmissionRejected, NotificationTargetKinds.Collection, 42, null, null, null },
    };

    [Theory]
    [MemberData(nameof(Targets))]
    public void EachType_ResolvesToItsExactDestination(NotificationType type, string kind, long? collectionId, long? itemId, string? publicId, string? focus)
    {
        var target = NotificationInboxPolicy.ResolveTarget(Record(type));

        Assert.Equal(new NotificationTargetDto(kind, collectionId, itemId, publicId, focus), target);
    }

    [Fact]
    public void ApprovalRequest_OpensTheQueue_OnlyForTheOwner()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.CollectionSubmissions, CollectionId: 42),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkSubmissionReceived, owner: true)));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkSubmissionReceived, owner: false)));
    }

    [Fact]
    public void Invitation_PendingOpensTheInvitations_AcceptedOpensTheCollection_OtherwiseUnavailable()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.CollectionInvitations, CollectionId: 42),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionInvitationReceived, belongs: false, invitationPending: true)));
        Assert.Equal(
            NotificationTargetKinds.Collection,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionInvitationReceived, belongs: true)).Kind);
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionInvitationReceived, belongs: false)));
    }

    [Fact]
    public void LinkShared_OpensThePublicLinkWhileItIsOn()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.PublicCollection, PublicId: "pub_12345678"),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkShared, belongs: false, publicId: "pub_12345678")));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkShared, belongs: false)));
    }

    [Fact]
    public void ReactionOrComment_OnALinkNoLongerThere_FallsBackToTheCollection_ThenUnavailable()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.Collection, CollectionId: 42),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionItemCommentReceived, linkStillOwn: false)));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionItemReactionReceived, belongs: false)));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionItemsAdded, live: false)));
    }

    [Fact]
    public void ProposalResult_ForANonMember_OpensThePublicLink_OrNothing()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.PublicCollection, PublicId: "pub_12345678"),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkSubmissionApproved, belongs: false, publicId: "pub_12345678")));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkSubmissionRejected, belongs: false)));
        Assert.Equal(
            NotificationTargetDto.Unavailable,
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.CollectionLinkSubmissionRejected, live: false, publicId: "pub_12345678")));
    }

    [Theory]
    [InlineData(NotificationType.RepeatPurchaseDue)]
    [InlineData(NotificationType.CollectionInvitationAnswered)]
    [InlineData(NotificationType.CollectionContentChanged)]
    [InlineData(NotificationType.FriendRequestAnswered)]
    public void DataOnlyAndUnusedTypes_AreNotInTheInbox(NotificationType type)
    {
        Assert.False(NotificationInboxPolicy.IsInboxType(type));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(type)));
    }

    [Fact]
    public void TheInboxTypes_AndTheIndexPredicate_AreTheSameSet()
    {
        var fromSql = NotificationInboxPolicy.InboxTypesSql
            .Replace("[Type] IN (", string.Empty).TrimEnd(')')
            .Split(',').Select(value => (NotificationType)byte.Parse(value.Trim()));
        Assert.Equal(NotificationInboxPolicy.InboxTypes.Order(), fromSql.Order());
    }

    [Fact]
    public async Task Rows_UseThePushWording_InTheRequestedLanguage()
    {
        var store = new FakeStore(Record(NotificationType.CollectionItemCommentReceived));
        var page = await Service(store).ListAsync(5, null, null, "ko");

        var row = Assert.Single(page.Items);
        var push = SocialPushText.For(NotificationType.CollectionItemCommentReceived, "ko", "Kim", "여행");
        Assert.Equal(push.Title, row.Title);
        Assert.Equal(push.Body, row.Body);
        Assert.Equal("collectionItemComment", row.Type);
        Assert.Equal("Kim", row.Actor!.DisplayName);
        Assert.Equal("ABCDEFGH", row.Actor.JupleId);
        Assert.Equal("여행", row.CollectionName);
    }

    [Fact]
    public async Task AnUnavailableRow_NamesNothing()
    {
        var store = new FakeStore(Record(NotificationType.CollectionItemReactionReceived, belongs: false));
        var row = Assert.Single((await Service(store).ListAsync(5, null, null, "ko")).Items);

        Assert.Equal(NotificationTargetDto.Unavailable, row.Target);
        Assert.Null(row.Title);
        Assert.Null(row.Body);
        Assert.Null(row.Actor);
        Assert.Null(row.CollectionName);
    }

    [Fact]
    public async Task AProposal_NeverShowsWhoSentIt_AndAPublicLinkAdd_NeverShowsWhoAdded()
    {
        var store = new FakeStore(
            Record(NotificationType.CollectionLinkSubmissionReceived, owner: true, actorHidden: true, id: 2),
            Record(NotificationType.CollectionItemsAdded, actorHidden: true, id: 1));
        var rows = (await Service(store).ListAsync(5, null, null, "en")).Items;

        Assert.All(rows, row => Assert.Null(row.Actor));
        Assert.Equal(SocialPushText.For(NotificationType.CollectionItemsAdded, "en", string.Empty, "여행", viaPublicLink: true).Body, rows[1].Body);
    }

    [Fact]
    public async Task EachDistinctActorPhoto_IsSignedOncePerPage()
    {
        var signer = new CountingImageStorage();
        var store = new FakeStore(Enumerable.Range(1, 10)
            .Select(index => Record(NotificationType.CollectionItemReactionReceived, id: index))
            .ToArray());

        await new NotificationInboxService(store, new FixedTime(), signer).ListAsync(5, null, null, "en");

        Assert.Equal(1, signer.Calls);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(101)]
    public async Task Limit_OutsideOneToHundred_IsRejected(int limit)
    {
        var exception = await Assert.ThrowsAsync<InvalidNotificationRequestException>(
            () => Service(new FakeStore()).ListAsync(5, null, limit, null));
        Assert.Equal("limit", exception.Field);
    }

    [Fact]
    public async Task Paging_ReturnsTheLastIdAsCursor_OnlyWhenMoreExist()
    {
        var store = new FakeStore(Enumerable.Range(1, 3).Select(index => Record(NotificationType.CollectionItemsAdded, id: 10 - index)).ToArray());

        var first = await Service(store).ListAsync(5, null, 2, null);
        Assert.Equal([9L, 8L], first.Items.Select(row => row.Id));
        Assert.Equal(8, first.NextCursor);
        var last = await Service(store).ListAsync(5, 8, 2, null);
        Assert.Equal([7L], last.Items.Select(row => row.Id));
        Assert.Null(last.NextCursor);
    }

    [Fact]
    public async Task ReadingSomeoneElsesOrAMissingNotification_IsNotFound()
    {
        await Assert.ThrowsAsync<NotificationNotFoundException>(() => Service(new FakeStore()).MarkReadAsync(5, 999));
        await Assert.ThrowsAsync<NotificationNotFoundException>(() => Service(new FakeStore()).GetAsync(5, 999, null));
    }

    [Fact]
    public async Task ARow_SerializesWithoutPrivateFields()
    {
        var store = new FakeStore(Record(NotificationType.CollectionItemCommentReceived));
        var json = JsonSerializer.Serialize((await Service(store).ListAsync(5, null, null, "en")).Items);

        Assert.DoesNotContain("users/31", json, StringComparison.Ordinal);
        Assert.DoesNotContain("\"UserId\"", json, StringComparison.Ordinal);
        Assert.DoesNotContain("31", json.Replace("ABCDEFGH", string.Empty), StringComparison.Ordinal);
    }

    public static TheoryData<NotificationType> PushTypes() => new()
    {
        NotificationType.FriendRequestReceived,
        NotificationType.CollectionInvitationReceived,
        NotificationType.CollectionInvitationAnswered,
        NotificationType.CollectionContentChanged,
        NotificationType.FriendRequestAnswered,
        NotificationType.CollectionItemsAdded,
        NotificationType.CollectionLinkShared,
        NotificationType.CollectionItemReactionReceived,
        NotificationType.CollectionItemCommentReceived,
        NotificationType.CollectionLinkSubmissionReceived,
        NotificationType.CollectionLinkSubmissionApproved,
        NotificationType.CollectionLinkSubmissionRejected,
    };

    /// <summary>Every Push carries the recipient's own notification id - the app's canonical reference - plus the legacy routing ids.</summary>
    [Theory]
    [MemberData(nameof(PushTypes))]
    public void EveryPush_CarriesItsNotificationId_AndKeepsTheLegacyRoutingFields(NotificationType type)
    {
        var notification = Notification.Social(5, type, 9, 42, 77, "k", Now);
        typeof(Notification).GetProperty(nameof(Notification.Id))!.SetValue(notification, 1234L);
        var context = new PushDispatchContext(true, "Kim", "여행", 0, "pub_12345678", RecipientBelongs: true);

        var data = FirebaseCloudMessagingSender.BuildDataPayload(DispatchPendingPushNotificationsService.BuildPayload(notification, context, "en"));

        Assert.Equal("1234", data["notificationId"]);
        Assert.Equal(SocialNotificationPolicy.WireType(type), data["type"]);
        if (type == NotificationType.CollectionLinkShared)
        {
            Assert.Equal("pub_12345678", data["publicId"]);
        }
        else
        {
            Assert.Equal("42", data["collectionId"]);
        }

        // Ids only - never names or text.
        Assert.All(data.Values, value => Assert.DoesNotContain("Kim", value, StringComparison.Ordinal));
        Assert.All(data.Values, value => Assert.DoesNotContain("여행", value, StringComparison.Ordinal));
    }

    private static NotificationInboxService Service(FakeStore store) => new(store, new FixedTime());

    private sealed class FixedTime : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private sealed class FakeStore(params NotificationInboxRecord[] records) : INotificationInboxStore
    {
        public Task<IReadOnlyList<NotificationInboxRecord>> ListAsync(long userId, long? beforeId, int take, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<NotificationInboxRecord>>(records
                .Where(record => beforeId is null || record.Id < beforeId)
                .OrderByDescending(record => record.Id)
                .Take(take)
                .ToList());

        public Task<NotificationInboxRecord?> GetAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(records.FirstOrDefault(record => record.Id == notificationId));

        public Task<int> CountUnreadAsync(long userId, CancellationToken cancellationToken = default) =>
            Task.FromResult(records.Count(record => record.ReadAtUtc is null));

        public Task<bool> MarkReadAsync(long userId, long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(records.Any(record => record.Id == notificationId));

        public Task<int> MarkAllReadAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) => Task.FromResult(0);

        public Task<int> MarkCollectionReadAsync(long userId, long collectionId, NotificationType type, DateTimeOffset nowUtc, CancellationToken cancellationToken = default) =>
            Task.FromResult(0);
    }

    private sealed class CountingImageStorage : Juple.Application.Users.Profile.IUserProfileImageStorage
    {
        public int Calls { get; private set; }

        public Task<string> UploadProfileImageAsync(long userId, Juple.Application.Images.ImageFormat format, byte[] content, CancellationToken cancellationToken = default) =>
            throw new NotSupportedException();

        public Task DeleteProfileImageAsync(long userId, string blobName, CancellationToken cancellationToken = default) => Task.CompletedTask;

        public Task<Uri?> CreateProfileImageReadUrlAsync(long userId, string blobName, CancellationToken cancellationToken = default)
        {
            Calls++;
            return Task.FromResult<Uri?>(new Uri("https://storage.test/signed"));
        }
    }
}
