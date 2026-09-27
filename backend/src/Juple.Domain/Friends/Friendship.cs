namespace Juple.Domain.Friends;

public enum FriendshipStatus
{
    Pending,
    Accepted,
}

/// <summary>
/// A friend request or an accepted friendship between two users, stored once per pair in canonical
/// order (UserLowId &lt; UserHighId) so a pair can never have two rows. Friendship grants nothing:
/// it is never a Collection permission - only a way to find people again (e.g. to pick them for a
/// Collection invitation, which still goes through the normal invitation/accept flow).
/// </summary>
public sealed class Friendship
{
    private Friendship()
    {
    }

    private Friendship(long userLowId, long userHighId, long requestedByUserId, DateTimeOffset createdAtUtc)
    {
        UserLowId = userLowId;
        UserHighId = userHighId;
        RequestedByUserId = requestedByUserId;
        Status = FriendshipStatus.Pending;
        CreatedAtUtc = createdAtUtc;
    }

    /// <summary>A pending request from requester to recipient (two different users).</summary>
    public static Friendship Request(long requesterUserId, long recipientUserId, DateTimeOffset createdAtUtc)
    {
        if (requesterUserId == recipientUserId)
        {
            throw new ArgumentException("A user cannot befriend themself.", nameof(recipientUserId));
        }

        return new Friendship(
            Math.Min(requesterUserId, recipientUserId),
            Math.Max(requesterUserId, recipientUserId),
            requesterUserId,
            createdAtUtc);
    }

    public long Id { get; private set; }

    public long UserLowId { get; private set; }

    public long UserHighId { get; private set; }

    public long RequestedByUserId { get; private set; }

    public FriendshipStatus Status { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? AcceptedAtUtc { get; private set; }

    public byte[] RowVersion { get; private set; } = [];

    public bool Involves(long userId) => UserLowId == userId || UserHighId == userId;

    public long OtherUserId(long userId) => UserLowId == userId ? UserHighId : UserLowId;

    /// <summary>A pending request addressed to this user (they did not send it).</summary>
    public bool IsIncomingRequestFor(long userId) =>
        Status == FriendshipStatus.Pending && Involves(userId) && RequestedByUserId != userId;

    public void Accept(DateTimeOffset acceptedAtUtc)
    {
        if (Status != FriendshipStatus.Pending)
        {
            return;
        }

        Status = FriendshipStatus.Accepted;
        AcceptedAtUtc = acceptedAtUtc;
    }
}
