using Juple.Domain.Notifications;
using Juple.Domain.Push;

namespace Juple.Application.Notifications;

/// <summary>
/// Records social events (NotificationType 1-12) in the durable outbox (notifications.NotificationEvents):
/// ONE small row per event, whatever the number of recipients - never a recipient list, never a Push.
/// Called inside the same SQL transaction as the change it is about (see BeginAtomicScopeAsync and
/// NotificationOutbox.BeginAsync), so the change and the intent to notify commit - or roll back -
/// together; a failure to record the event therefore fails the change too. Who is told, and the
/// Push itself, happen later and asynchronously: the notification worker (woken through Service Bus
/// right after the commit) or, if that signal is lost, the recovery Job - see NotificationEventProcessor.
/// </summary>
public interface ISocialNotificationPublisher
{
    /// <summary>
    /// Opens the transaction the change and its outbox events share (or joins the one already open on
    /// the request). Committing it hands the new events' ids to the signal (an immediate, non-blocking
    /// in-process hand-off - no network call on the request path); a lost signal only delays the Push
    /// until the recovery Job. Disposing it uncommitted rolls back.
    /// </summary>
    Task<INotificationOutboxScope> BeginAtomicScopeAsync(CancellationToken cancellationToken = default) =>
        Task.FromResult<INotificationOutboxScope>(NotificationOutbox.NoOpScope.Instance);

    /// <summary>
    /// Signals the events recorded so far by this request - for a caller that committed its own
    /// transaction around them (a joined scope never signals by itself). Best-effort, never throws.
    /// </summary>
    Task FlushSignalsAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

    Task FriendRequestReceivedAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Tells the requester - with a visible notification that is also a signal for an open Friends
    /// screen - that their request was accepted or declined. Recorded only by the call that actually
    /// answered it (never for a cancel by the requester, never for an idempotent replay).
    /// </summary>
    Task FriendRequestAnsweredAsync(long answererUserId, long requesterUserId, long friendshipId, bool accepted, CancellationToken cancellationToken = default);

    /// <summary>
    /// A friend request changed without a result for the other person (the requester CANCELLED it): tells the
    /// recipient's open Friends screen - data-only, never an Inbox row or a tray notification - so the stale
    /// request leaves 받은 요청 at once instead of at their next visit. Not a notification: pure state invalidation.
    /// </summary>
    Task FriendRequestCancelledAsync(long requesterUserId, long recipientUserId, long friendshipId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

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
    /// actorUserId replied to recipientUserId's comment (replyCommentId is the NEW reply): only the answered person is told - never
    /// the link's owner or the thread's root author as such, never the text. One notification per reply.
    /// </summary>
    Task CommentReplyReceivedAsync(long actorUserId, long recipientUserId, long collectionId, long itemId, long replyCommentId, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;

    /// <summary>
    /// actorUserId hearted recipientUserId's comment: the comment's author is told once per person and comment, however often the
    /// heart is toggled (the event's key is the pair, not a time window).
    /// </summary>
    Task CommentLikeReceivedAsync(long actorUserId, long recipientUserId, long collectionId, long itemId, long commentId, CancellationToken cancellationToken = default) =>
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
    Task CollectionLinkSubmissionAnsweredAsync(long submitterUserId, long collectionId, long submissionId, long itemId, bool approved, CancellationToken cancellationToken = default) =>
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
    /// <summary>Social notifications not yet dispatched and created before createdBefore, oldest first (the recovery sweep).</summary>
    Task<IReadOnlyList<Notification>> ListPendingAsync(int limit, DateTimeOffset createdBefore, CancellationToken cancellationToken = default);

    /// <summary>Those of these social notifications not yet dispatched (the fast path's batch, as a queue message names it).</summary>
    Task<IReadOnlyList<Notification>> ListUndispatchedAsync(IReadOnlyCollection<long> notificationIds, CancellationToken cancellationToken = default);

    /// <summary>
    /// The send-time context of every one of these notifications, decided together: a fixed number of
    /// set queries per batch, never a query per notification or per recipient.
    /// </summary>
    Task<IReadOnlyDictionary<long, PushDispatchContext>> GetContextsAsync(
        IReadOnlyList<Notification> notifications, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task MarkDispatchedAsync(IReadOnlyCollection<long> notificationIds, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
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

    /// <summary>
    /// TryClaimAsync for a whole batch: the new claims are inserted together (batched, not one round
    /// trip each); any pair that already has a row falls back to the same conditional reclaim. Returns
    /// the pairs this caller now owns.
    /// </summary>
    Task<IReadOnlySet<DeliveryKey>> TryClaimManyAsync(IReadOnlyCollection<DeliveryKey> deliveries, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    Task RecordAttemptAsync(
        long notificationId,
        long pushDeviceRegistrationId,
        NotificationDeliveryStatus status,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode,
        CancellationToken cancellationToken = default);

    /// <summary>The outcomes of a batch of claimed deliveries, written together.</summary>
    Task RecordAttemptsAsync(IReadOnlyCollection<DeliveryAttempt> attempts, CancellationToken cancellationToken = default);
}

/// <summary>One (notification, device) delivery.</summary>
public readonly record struct DeliveryKey(long NotificationId, long PushDeviceRegistrationId);

public sealed record DeliveryAttempt(
    DeliveryKey Key, NotificationDeliveryStatus Status, DateTimeOffset AttemptedAtUtc, string? ProviderMessageId, string? FailureCode);

/// <param name="EventsRecovered">Outbox events the run had to process itself (their fast-path signal was lost or their processor died).</param>
/// <param name="EventRetriesScheduled">Outbox events whose attempt in this run failed - each rescheduled with back-off in SQL.</param>
public sealed record DispatchPendingPushNotificationsResult(int Pending, int Sent, int Failed, int Skipped, int Expired, int EventsRecovered = 0, int EventRetriesScheduled = 0);

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

    /// <summary>Content-change notifications per recipient and Collection are coalesced into one per this window.</summary>
    public static readonly TimeSpan ContentChangeCoalescing = TimeSpan.FromMinutes(1);

    /// <summary>Reactions (and comments) by one person on one link are coalesced into one notification per this window.</summary>
    public static readonly TimeSpan CollaborationCoalescing = TimeSpan.FromMinutes(1);

    public static bool IsDataOnly(NotificationType type) =>
        type is NotificationType.CollectionInvitationAnswered
            or NotificationType.CollectionContentChanged
            or NotificationType.FriendRequestAnswered; // legacy: only rows recorded before 13/14 existed

    public static TimeSpan MaxAge(NotificationType type) => IsDataOnly(type) ? DataOnlyMaxAge : VisibleMaxAge;

    /// <summary>Stable data-payload "type" values Mobile branches on.</summary>
    public static string WireType(NotificationType type) => type switch
    {
        NotificationType.FriendRequestReceived => "friendRequest",
        NotificationType.CollectionInvitationReceived => "collectionInvitation",
        NotificationType.CollectionInvitationAnswered => "collectionInvitationAnswered",
        NotificationType.CollectionContentChanged => "collectionContentChanged",
        NotificationType.FriendRequestAnswered => "friendRequestAnswered",
        NotificationType.FriendRequestAccepted => "friendRequestAccepted",
        NotificationType.FriendRequestRejected => "friendRequestRejected",
        NotificationType.CollectionItemsAdded => "collectionItemsAdded",
        NotificationType.CollectionLinkShared => "collectionLinkShared",
        NotificationType.CollectionItemReactionReceived => "collectionItemReaction",
        NotificationType.CollectionItemCommentReceived => "collectionItemComment",
        NotificationType.CollectionLinkSubmissionReceived => "collectionLinkSubmission",
        NotificationType.CollectionLinkSubmissionApproved => "collectionLinkSubmissionApproved",
        NotificationType.CollectionLinkSubmissionRejected => "collectionLinkSubmissionRejected",
        NotificationType.CommentReplyReceived => "commentReply",
        NotificationType.CommentLikeReceived => "commentLike",
        _ => "unknown",
    };

    /// <summary>One per person, link, kind and CollaborationCoalescing window.</summary>
    public static string CollaborationDedupKey(NotificationType type, long collectionId, long itemId, long actorUserId, DateTimeOffset nowUtc) =>
        $"collection-{(type == NotificationType.CollectionItemCommentReceived ? "comment" : "reaction")}:{collectionId}:{itemId}:{actorUserId}:"
        + $"{nowUtc.ToUnixTimeSeconds() / (long)CollaborationCoalescing.TotalSeconds}";

    /// <summary>Unique per add operation (operationId) - two separate adds are two notifications.</summary>
    public static string ItemsAddedDedupKey(long collectionId, long recipientUserId, Guid operationId) =>
        $"collection-items:{collectionId}:{recipientUserId}:{operationId:N}";

    /// <summary>The same for an outbox event: one per add operation (its event) and recipient - re-materializing the event never duplicates it.</summary>
    public static string ItemsAddedDedupKey(long collectionId, long recipientUserId, long eventId) =>
        $"collection-items:{collectionId}:{recipientUserId}:e{eventId}";

    public static string ContentChangeDedupKey(long collectionId, long recipientUserId, DateTimeOffset nowUtc) =>
        $"collection-content:{collectionId}:{recipientUserId}:{nowUtc.ToUnixTimeSeconds() / (long)ContentChangeCoalescing.TotalSeconds}";
}
