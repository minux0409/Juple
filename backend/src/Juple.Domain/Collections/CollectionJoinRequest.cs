namespace Juple.Domain.Collections;

/// <summary>Persisted as its name (string), never its ordinal.</summary>
public enum CollectionJoinRequestStatus
{
    Pending,
    Approved,
    Rejected,

    /// <summary>The requester became a member another way (an invitation) before the Owner decided: nothing left to decide.</summary>
    Obsolete,
}

/// <summary>
/// "Please let me join this Collection": a signed-in non-member's request through a PRIVATE link (공용 컬렉션 OFF).
/// A different thing from an invitation (Owner to user) and from a link proposal (a URL for the Collection). Carries no role - an
/// approval always makes the person a Viewer (the Owner can change that like anyone's). At most one Pending request
/// per (Collection, requester), enforced by a filtered unique index; a declined requester may ask again (a new row).
/// </summary>
public sealed class CollectionJoinRequest
{
    private CollectionJoinRequest()
    {
    }

    public CollectionJoinRequest(long collectionId, long requesterUserId, DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        RequesterUserId = requesterUserId;
        CreatedAtUtc = createdAtUtc;
        Status = CollectionJoinRequestStatus.Pending;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long RequesterUserId { get; private set; }

    public CollectionJoinRequestStatus Status { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset? ResolvedAtUtc { get; private set; }

    public long? ResolvedByUserId { get; private set; }

    public void Resolve(CollectionJoinRequestStatus status, long? resolvedByUserId, DateTimeOffset resolvedAtUtc)
    {
        Status = status;
        ResolvedByUserId = resolvedByUserId;
        ResolvedAtUtc = resolvedAtUtc;
    }
}
