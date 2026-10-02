using Juple.Domain.Notifications;
using Juple.Domain.Push;

namespace Juple.Application.Notifications;

/// <summary>
/// Records social events for the Push outbox (notifications.Notifications - see NotificationType
/// 1-12). Called by the friend/collaboration/Collection services only AFTER their own change has
/// committed, and always best-effort: an implementation never throws, so a notification problem can
/// never undo or fail the user's action. Nothing here sends anything - the push-dispatch Job does
/// (see DispatchPendingPushNotificationsService), which keeps the Firebase credential out of the API.
/// </summary>
public interface ISocialNotificationPublisher
{
    Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Tells the requester (data-only) that their request was accepted or declined, so an open
    /// Friends screen drops it from 보낸 친구 신청 - and lists the new friend if accepted - at once.
    /// </summary>
    Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, CancellationToken cancellationToken = default);

    Task CollectionInvitationReceivedAsync(long ownerUserId, long invitedUserId, long collectionId, long invitationId, CancellationToken cancellationToken = default);

    /// <summary>Tells the Owner (data-only) so an open Share screen refreshes its 공유 중 / 초대 대기 lists.</summary>
    Task CollectionInvitationAnsweredAsync(long inviteeUserId, long invitationId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Links were added to or removed from these Collections: every other member (Owner included) of
    /// each one that is shared gets a coalesced data-only refresh. Unshared Collections notify nobody.
    /// </summary>
    Task CollectionsChangedAsync(long actorUserId, IReadOnlyCollection<long> collectionIds, CancellationToken cancellationToken = default);

    /// <summary>The same for every shared Collection that contains this Item (its deletion/restore changes their counts).</summary>
    Task ItemCollectionsChangedAsync(long actorUserId, long itemId, CancellationToken cancellationToken = default);

    /// <summary>
    /// One add operation put itemCount new links into this Collection: its Owner and every accepted
    /// member - except the actor, and except anyone who turned 새 링크 알림 off for it - get ONE visible
    /// notification (a bulk copy of N links is one notification, not N). hideActor (an add through the
    /// public link) never names who added. Nothing about the links themselves is recorded.
    /// </summary>
    Task CollectionItemsAddedAsync(long actorUserId, long collectionId, int itemCount, bool hideActor, CancellationToken cancellationToken = default);

    /// <summary>
    /// The Owner approved a proposed link (승인 후 추가): exactly a new link by its proposer (the actor,
    /// unnamed when hideActor), except that the approving Owner - who just did it - is not told either.
    /// </summary>
    Task CollectionLinkApprovedAsync(long ownerUserId, long submitterUserId, long collectionId, bool hideActor, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// actorUserId reacted to - or changed their reaction on - this link of a shared Collection: the
    /// link's owner (the Item's owner, not the Collection's) is told, unless they reacted themselves or
    /// no longer belong to the Collection. Never which reaction. Repeated changes by the same person on
    /// the same link are coalesced (SocialNotificationPolicy.CollaborationCoalescing).
    /// </summary>
    Task CollectionItemReactionReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>The same for a new comment - never its text. Several comments in a row by one person are one notification.</summary>
    Task CollectionItemCommentReceivedAsync(long actorUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// submitterUserId's link (their itemId) now waits for this Collection's Owner (승인 후 추가): the
    /// Owner is told - never by whom, so a proposal through the public link stays anonymous. Only
    /// called for a proposal that was actually recorded (never for a duplicate or a failure).
    /// </summary>
    Task CollectionLinkSubmittedAsync(long submitterUserId, long collectionId, long itemId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// The Owner approved (or declined) submissionId: its proposer is told the result - also someone who
    /// proposed through the public link and is no member. A result, not a new-link alert, so the
    /// Collection's 새 링크 알림 setting does not apply. Never who decided.
    /// </summary>
    Task CollectionLinkSubmissionAnsweredAsync(long submitterUserId, long collectionId, long submissionId, bool approved, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}

/// <summary>What the dispatcher needs to decide on and word one pending social notification.</summary>
/// <param name="IsRelevant">False once the subject is gone or answered (request accepted/declined/cancelled, invitation expired/revoked, membership removed) - then nothing is sent.</param>
/// <param name="BadgeCount">The recipient's unanswered friend requests + Collection invitations right now (launcher badge).</param>
/// <param name="PublicShareId">CollectionLinkShared, and a proposal result for someone who is no member: the Collection's public link as it is right now (the push opens it).</param>
/// <param name="RecipientBelongs">Proposal results only: the recipient owns or belongs to the Collection now, so the push may open it by its id.</param>
/// <remarks>
/// For CollectionItemsAdded, IsRelevant is also false once the recipient turned 새 링크 알림 off; for
/// CollectionLinkShared, once the public link was turned off (or the Collection deleted).
/// </remarks>
public sealed record PushDispatchContext(
    bool IsRelevant, string? ActorName, string? CollectionName, int BadgeCount, string? PublicShareId = null, bool RecipientBelongs = true);

public interface IPushDispatchStore
{
    /// <summary>Social notifications not yet dispatched, oldest first.</summary>
    Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, CancellationToken cancellationToken = default);

    Task<PushDispatchContext> GetContextAsync(Notification notification, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task MarkDispatchedAsync(long notificationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public interface INotificationDeliveryStore
{
    /// <summary>
    /// Atomically claims this (notification, device) pair into Sending and returns true - only if no
    /// delivery row exists yet, the existing one is Failed, or it is Sending with a stale lease (its
    /// claimer most likely crashed). False if it is already Sent or another pass holds a live claim.
    /// The insert race resolves through the unique index; the reclaim is one conditional UPDATE.
    /// </summary>
    Task<bool> TryClaimAsync(long notificationId, long pushDeviceRegistrationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RecordAttemptAsync(
        long notificationId,
        long pushDeviceRegistrationId,
        NotificationDeliveryStatus status,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode,
        CancellationToken cancellationToken = default);
}

public sealed record DispatchPendingPushNotificationsResult(int Pending, int Sent, int Failed, int Skipped, int Expired);

public interface IDispatchPendingPushNotificationsService
{
    Task<DispatchPendingPushNotificationsResult> RunOnceAsync(CancellationToken cancellationToken = default);
}

/// <summary>Who the data-only refresh events are for, and how long an unsent notification is still worth sending.</summary>
public static class SocialNotificationPolicy
{
    /// <summary>A friend request/invitation Push older than this is dropped rather than sent late.</summary>
    public static readonly TimeSpan VisibleMaxAge = TimeSpan.FromHours(6);

    /// <summary>A refresh event is useless once the app would have refreshed on its own anyway.</summary>
    public static readonly TimeSpan DataOnlyMaxAge = TimeSpan.FromMinutes(10);

    /// <summary>Content-change events per recipient and Collection are coalesced into one per this window.</summary>
    public static readonly TimeSpan ContentChangeCoalescing = TimeSpan.FromMinutes(1);

    /// <summary>Reactions (and comments) by one person on one link are coalesced into one notification per this window.</summary>
    public static readonly TimeSpan CollaborationCoalescing = TimeSpan.FromMinutes(1);

    public static bool IsDataOnly(NotificationType type) =>
        type is NotificationType.CollectionInvitationAnswered
            or NotificationType.CollectionContentChanged
            or NotificationType.FriendRequestAnswered;

    public static TimeSpan MaxAge(NotificationType type) => IsDataOnly(type) ? DataOnlyMaxAge : VisibleMaxAge;

    /// <summary>Stable data-payload "type" values Mobile branches on.</summary>
    public static string WireType(NotificationType type) => type switch
    {
        NotificationType.FriendRequestReceived => "friendRequest",
        NotificationType.CollectionInvitationReceived => "collectionInvitation",
        NotificationType.CollectionInvitationAnswered => "collectionInvitationAnswered",
        NotificationType.CollectionContentChanged => "collectionContentChanged",
        NotificationType.FriendRequestAnswered => "friendRequestAnswered",
        NotificationType.CollectionItemsAdded => "collectionItemsAdded",
        NotificationType.CollectionLinkShared => "collectionLinkShared",
        NotificationType.CollectionItemReactionReceived => "collectionItemReaction",
        NotificationType.CollectionItemCommentReceived => "collectionItemComment",
        NotificationType.CollectionLinkSubmissionReceived => "collectionLinkSubmission",
        NotificationType.CollectionLinkSubmissionApproved => "collectionLinkSubmissionApproved",
        NotificationType.CollectionLinkSubmissionRejected => "collectionLinkSubmissionRejected",
        _ => "unknown",
    };

    /// <summary>One per person, link, kind and CollaborationCoalescing window.</summary>
    public static string CollaborationDedupKey(NotificationType type, long collectionId, long itemId, long actorUserId, DateTimeOffset nowUtc) =>
        $"collection-{(type == NotificationType.CollectionItemCommentReceived ? "comment" : "reaction")}:{collectionId}:{itemId}:{actorUserId}:"
        + $"{nowUtc.ToUnixTimeSeconds() / (long)CollaborationCoalescing.TotalSeconds}";

    /// <summary>Unique per add operation (operationId) - two separate adds are two notifications.</summary>
    public static string ItemsAddedDedupKey(long collectionId, long recipientUserId, Guid operationId) =>
        $"collection-items:{collectionId}:{recipientUserId}:{operationId:N}";

    public static string ContentChangeDedupKey(long collectionId, long recipientUserId, DateTimeOffset nowUtc) =>
        $"collection-content:{collectionId}:{recipientUserId}:{nowUtc.ToUnixTimeSeconds() / (long)ContentChangeCoalescing.TotalSeconds}";
}
