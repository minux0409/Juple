using Juple.Application.Notifications;
using Juple.Domain.Notifications;

namespace Juple.UnitTests.Notifications;

/// <summary>R40-C: which notification types a Collection's 알림 setting can silence (Push only - never the Inbox row).</summary>
public sealed class CollectionNotificationDeliveryPolicyTests
{
    public static TheoryData<NotificationType> Gated => new()
    {
        NotificationType.CollectionItemsAdded,
        NotificationType.CollectionItemReactionReceived,
        NotificationType.CollectionItemCommentReceived,
        NotificationType.CommentReplyReceived,
        NotificationType.CommentLikeReceived,
        NotificationType.CollectionLinkSubmissionReceived,
    };

    [Theory]
    [MemberData(nameof(Gated))]
    public void CollectionActivity_CanBeSilencedPerCollection(NotificationType type) =>
        Assert.True(SocialNotificationPolicy.IsCollectionPreferenceGated(type));

    [Theory]
    [InlineData(NotificationType.FriendRequestReceived)]
    [InlineData(NotificationType.FriendRequestAccepted)]
    [InlineData(NotificationType.FriendRequestRejected)]
    [InlineData(NotificationType.CollectionInvitationReceived)]
    [InlineData(NotificationType.CollectionLinkShared)]
    [InlineData(NotificationType.CollectionLinkSubmissionApproved)]
    [InlineData(NotificationType.CollectionLinkSubmissionRejected)]
    [InlineData(NotificationType.CollectionContentChanged)]
    [InlineData(NotificationType.CollectionInvitationAnswered)]
    [InlineData(NotificationType.RepeatPurchaseDue)]
    public void AccountScopedAlertsResultsAndRefreshSignals_AreNeverSilencedByACollection(NotificationType type) =>
        Assert.False(SocialNotificationPolicy.IsCollectionPreferenceGated(type));

    [Fact]
    public void EveryGatedTypeStaysInTheInbox_SoSilencingNeverHidesHistory() =>
        Assert.All(Enum.GetValues<NotificationType>().Where(SocialNotificationPolicy.IsCollectionPreferenceGated),
            type => Assert.True(Juple.Application.Notifications.Inbox.NotificationInboxPolicy.IsInboxType(type)));
}
