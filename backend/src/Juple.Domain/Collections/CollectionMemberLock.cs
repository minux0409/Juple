namespace Juple.Domain.Collections;

/// <summary>
/// One user's PERSONAL lock on a Collection that someone else owns (shared with them). It is not the Owner's Collection lock and not the
/// Collection's share password: it protects only this person's own access, opens with this person's own lock password, and nobody else -
/// not the Owner, not another member, not a public-link visitor - is told about it or affected by it. At most one row per
/// (CollectionId, UserId). The row is kept when the lock is removed (IsLocked = false) so <see cref="LockVersion"/> only ever grows: an
/// unlock grant issued for an earlier lock can never open a later one.
/// </summary>
public sealed class CollectionMemberLock
{
    private CollectionMemberLock()
    {
    }

    public CollectionMemberLock(long userId, long collectionId, DateTimeOffset lockedAtUtc)
    {
        UserId = userId;
        CollectionId = collectionId;
        IsLocked = true;
        LockVersion = 1;
        CreatedAtUtc = lockedAtUtc;
        UpdatedAtUtc = lockedAtUtc;
    }

    public long Id { get; private set; }

    public long UserId { get; private set; }

    public long CollectionId { get; private set; }

    public bool IsLocked { get; private set; }

    /// <summary>Grows with every lock and unlock; unlock grants carry it.</summary>
    public int LockVersion { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public void Lock(DateTimeOffset nowUtc)
    {
        if (IsLocked)
        {
            return;
        }

        IsLocked = true;
        LockVersion++;
        UpdatedAtUtc = nowUtc;
    }

    public void Unlock(DateTimeOffset nowUtc)
    {
        if (!IsLocked)
        {
            return;
        }

        IsLocked = false;
        LockVersion++;
        UpdatedAtUtc = nowUtc;
    }
}
