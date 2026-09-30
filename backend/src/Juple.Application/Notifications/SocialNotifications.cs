using Juple.Domain.Notifications;
using Juple.Domain.Push;

namespace Juple.Application.Notifications;

/// <summary>
/// Records social events for the Push outbox (notifications.Notifications - see NotificationType
/// 1-6). Called by the friend/collaboration/Collection services only AFTER their own change has
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
}

/// <summary>What the dispatcher needs to decide on and word one pending social notification.</summary>
/// <param name="IsRelevant">False once the subject is gone or answered (request accepted/declined/cancelled, invitation expired/revoked, membership removed) - then nothing is sent.</param>
/// <param name="BadgeCount">The recipient's unanswered friend requests + Collection invitations right now (launcher badge).</param>
/// <remarks>For CollectionItemsAdded, IsRelevant is also false once the recipient turned 새 링크 알림 off.</remarks>
public sealed record PushDispatchContext(bool IsRelevant, string? ActorName, string? CollectionName, int BadgeCount);

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
        _ => "unknown",
    };

    /// <summary>Unique per add operation (operationId) - two separate adds are two notifications.</summary>
    public static string ItemsAddedDedupKey(long collectionId, long recipientUserId, Guid operationId) =>
        $"collection-items:{collectionId}:{recipientUserId}:{operationId:N}";

    public static string ContentChangeDedupKey(long collectionId, long recipientUserId, DateTimeOffset nowUtc) =>
        $"collection-content:{collectionId}:{recipientUserId}:{nowUtc.ToUnixTimeSeconds() / (long)ContentChangeCoalescing.TotalSeconds}";
}
