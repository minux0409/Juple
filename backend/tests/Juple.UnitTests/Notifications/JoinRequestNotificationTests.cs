using Juple.Application.Notifications;
using Juple.Application.Notifications.Inbox;
using Juple.Domain.Notifications;

namespace Juple.UnitTests.Notifications;

/// <summary>The three join-request types (17-19): where tapping them leads, who they name, and their push wording in every locale.</summary>
public sealed class JoinRequestNotificationTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 9, 12, 0, 0, TimeSpan.Zero);
    private static readonly NotificationInboxActor Kim = new(31, "ABCDEFGH", "Kim", null);

    private static NotificationInboxRecord Record(
        NotificationType type, bool live = true, bool owner = false, bool belongs = false, string? publicId = null, NotificationInboxActor? actor = null) =>
        new(1, type, Now, null, null, 42, 9, false, actor, live ? "여행" : null, live, owner && live, (belongs || owner) && live, live ? publicId : null, false, false);

    [Fact]
    public void TheOwnersRequest_OpensTheRequestList_OnlyForTheOwnerOfALiveCollectionWithARequester()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.CollectionJoinRequests, CollectionId: 42),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestReceived, owner: true, actor: Kim)));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestReceived, owner: false, actor: Kim)));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestReceived, live: false, owner: true, actor: Kim)));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestReceived, owner: true)));
    }

    [Fact]
    public void AnApprovedRequest_OpensTheNormalCollection_ForAMember_AndNothingOtherwise()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.Collection, CollectionId: 42),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestApproved, belongs: true)));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestApproved, belongs: false)));
    }

    [Fact]
    public void ADeclinedRequest_OpensThePublicLinkWhileItIsOn_ElseNothing_NeverAMembersView()
    {
        Assert.Equal(
            new NotificationTargetDto(NotificationTargetKinds.PublicCollection, PublicId: "pub"),
            NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestRejected, publicId: "pub")));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestRejected)));
        Assert.Equal(NotificationTargetDto.Unavailable, NotificationInboxPolicy.ResolveTarget(Record(NotificationType.JoinRequestRejected, live: false, publicId: "pub")));
    }

    [Fact]
    public void AllThreeAreInboxRows_AndOnlyTheRequestNamesAnyone()
    {
        foreach (var type in new[] { NotificationType.JoinRequestReceived, NotificationType.JoinRequestApproved, NotificationType.JoinRequestRejected })
        {
            Assert.True(NotificationInboxPolicy.IsInboxType(type));
            Assert.Contains(((int)type).ToString(), NotificationInboxPolicy.InboxTypesSql);
        }

        Assert.True(NotificationInboxPolicy.ShowsActor(NotificationType.JoinRequestReceived));
        Assert.True(NotificationInboxPolicy.RequiresActor(NotificationType.JoinRequestReceived));
        Assert.False(NotificationInboxPolicy.ShowsActor(NotificationType.JoinRequestApproved));
        Assert.False(NotificationInboxPolicy.ShowsActor(NotificationType.JoinRequestRejected));
    }

    [Fact]
    public void TheWireTypes_AreStable_AndNoneIsDataOnly()
    {
        Assert.Equal("joinRequest", SocialNotificationPolicy.WireType(NotificationType.JoinRequestReceived));
        Assert.Equal("joinRequestApproved", SocialNotificationPolicy.WireType(NotificationType.JoinRequestApproved));
        Assert.Equal("joinRequestRejected", SocialNotificationPolicy.WireType(NotificationType.JoinRequestRejected));
        Assert.All(
            new[] { NotificationType.JoinRequestReceived, NotificationType.JoinRequestApproved, NotificationType.JoinRequestRejected },
            type => Assert.False(SocialNotificationPolicy.IsDataOnly(type)));
    }

    [Theory]
    [InlineData("ko")]
    [InlineData("en")]
    [InlineData("ja")]
    [InlineData("zh-Hans")]
    [InlineData("zh-Hant")]
    [InlineData("es")]
    [InlineData("fr")]
    [InlineData("de")]
    [InlineData("it")]
    [InlineData("pt-BR")]
    [InlineData("vi")]
    [InlineData("th")]
    [InlineData("id")]
    [InlineData("ru")]
    [InlineData("tr")]
    [InlineData("ar")]
    [InlineData("hi")]
    public void EveryLocaleHasAllThreeTexts_WithTheRequesterAndTheCollectionAndNoOwnerNameInTheResults(string locale)
    {
        var (requestTitle, requestBody) = SocialPushText.For(NotificationType.JoinRequestReceived, locale, "RequesterName", "TripName");
        var (approvedTitle, approvedBody) = SocialPushText.For(NotificationType.JoinRequestApproved, locale, "OwnerName", "TripName");
        var (rejectedTitle, rejectedBody) = SocialPushText.For(NotificationType.JoinRequestRejected, locale, "OwnerName", "TripName");

        Assert.All(new[] { requestTitle, requestBody, approvedTitle, approvedBody, rejectedTitle, rejectedBody }, text => Assert.False(string.IsNullOrWhiteSpace(text)));
        Assert.Contains("RequesterName", requestBody);
        Assert.Contains("TripName", requestBody);
        Assert.DoesNotContain("{", requestBody + approvedBody + rejectedBody);
        Assert.DoesNotContain("OwnerName", approvedBody + rejectedBody);
        Assert.Contains("TripName", approvedBody);
        Assert.Contains("TripName", rejectedBody);
    }
}
