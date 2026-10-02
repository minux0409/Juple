namespace Juple.Application.Notifications;

/// <summary>
/// The DedupKey of an outbox event (UX_NotificationEvents_DedupKey) - one place for every producer, so
/// the two meanings are never mixed up:
///
///  1. Idempotency - the key is a business object's own id. That object causes this event exactly
///     once (a friend request is received once, an invitation answered once, a proposal approved or
///     declined once), so recording it again - a retried request, an idempotent replay - is not a new
///     event. A later, different occurrence is a different object with a different id, so it is
///     never blocked.
///  2. Coalescing - the key is a time bucket (window). Repeats inside the window are deliberately ONE
///     event (product rule: e.g. one reaction/comment notification per person and link per minute);
///     the next window is a different key, so an event from an earlier window - processed yesterday
///     or a minute ago - never blocks a legitimate new one.
///
/// Every other event has no key: each operation is its own event (new links added, a public link
/// passed on, a proposal received), made unique downstream by the event's own id.
///
/// Correctness never depends on the outbox row still existing: the same rules are applied again,
/// per recipient, to the Notification rows (UX_Notifications_DedupKey, kept with the notification),
/// so deleting processed events after their retention period changes nothing.
/// </summary>
public static class NotificationEventKeys
{
    // ---- 1. Idempotency: one event per business object ----

    public static string FriendRequestReceived(long friendshipId) => $"ev-friend-request:{friendshipId}";

    public static string FriendRequestAnswered(long friendshipId) => $"ev-friend-request-answered:{friendshipId}";

    public static string CollectionInvitationReceived(long invitationId) => $"ev-collection-invitation:{invitationId}";

    public static string CollectionInvitationAnswered(long invitationId) => $"ev-invitation-answered:{invitationId}";

    public static string CollectionLinkSubmissionAnswered(long submissionId, bool approved) =>
        $"ev-collection-submission-{(approved ? "approved" : "rejected")}:{submissionId}";

    // ---- 2. Coalescing: one event per scope and time window ----

    /// <summary>A Collection's content changed by this person: data-only refreshes coalesce per minute.</summary>
    public static string CollectionContentChanged(long collectionId, long actorUserId, DateTimeOffset nowUtc) =>
        $"ev-content:{collectionId}:{actorUserId}:{Window(nowUtc, SocialNotificationPolicy.ContentChangeCoalescing)}";

    /// <summary>An Item's deletion/restore (all its Collections) by this person, per minute.</summary>
    public static string ItemCollectionsChanged(long itemId, long actorUserId, DateTimeOffset nowUtc) =>
        $"ev-item-content:{itemId}:{actorUserId}:{Window(nowUtc, SocialNotificationPolicy.ContentChangeCoalescing)}";

    /// <summary>Reactions (or comments) by one person on one link: one event per CollaborationCoalescing window.</summary>
    public static string Collaboration(Juple.Domain.Notifications.NotificationType type, long collectionId, long itemId, long actorUserId, DateTimeOffset nowUtc) =>
        "ev-" + SocialNotificationPolicy.CollaborationDedupKey(type, collectionId, itemId, actorUserId, nowUtc);

    /// <summary>The window index of an instant (whole windows since the Unix epoch).</summary>
    public static long Window(DateTimeOffset nowUtc, TimeSpan window) => nowUtc.ToUnixTimeSeconds() / (long)window.TotalSeconds;
}
