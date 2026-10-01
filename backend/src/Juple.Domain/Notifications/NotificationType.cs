namespace Juple.Domain.Notifications;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values. Mirrors Juple.Domain.Purchases.IntervalUnit's
/// identical convention.
/// </summary>
public enum NotificationType : byte
{
    RepeatPurchaseDue = 0,

    /// <summary>Someone sent the recipient a friend request (SubjectId = the Friendship id). Visible Push.</summary>
    FriendRequestReceived = 1,

    /// <summary>The recipient was invited to a Collection (SubjectId = the invitation id). Visible Push.</summary>
    CollectionInvitationReceived = 2,

    /// <summary>An invitation the recipient (the Owner) sent was accepted or declined. Data-only Push - refreshes the Share screen.</summary>
    CollectionInvitationAnswered = 3,

    /// <summary>Links were added to/removed from a Collection the recipient belongs to. Data-only Push - refreshes counts.</summary>
    CollectionContentChanged = 4,

    /// <summary>A friend request the recipient sent was accepted or declined (SubjectId = the Friendship id). Data-only Push - refreshes the Friends screen.</summary>
    FriendRequestAnswered = 5,

    /// <summary>
    /// Visible: one or more links were added to a shared Collection the recipient owns or belongs
    /// to (one notification per add operation - a bulk copy of N links is one, with ItemCount N).
    /// </summary>
    CollectionItemsAdded = 6,

    /// <summary>
    /// Visible: someone passed on a Collection's public link to the recipient (CollectionId = the
    /// Collection, ActorUserId = the sender). Never a membership or an invitation - opening it is the
    /// public link page, with its own password gate. Sent only while that public link is still on.
    /// </summary>
    CollectionLinkShared = 7,
}
