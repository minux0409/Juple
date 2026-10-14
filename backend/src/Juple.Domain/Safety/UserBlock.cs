namespace Juple.Domain.Safety;

/// <summary>
/// "<see cref="BlockerUserId"/> does not want to interact with <see cref="BlockedUserId"/>". One row per ordered pair; the relation
/// restricts interaction in BOTH directions (see IUserBlockPolicy) but is only ever shown to the person who set it. It deletes nobody's
/// data and removes nobody from a shared Collection. Removed when either account is deleted.
/// </summary>
public sealed class UserBlock
{
    private UserBlock()
    {
    }

    public UserBlock(long blockerUserId, long blockedUserId, DateTimeOffset createdAtUtc)
    {
        if (blockerUserId == blockedUserId)
        {
            throw new ArgumentException("A user cannot block themself.", nameof(blockedUserId));
        }

        BlockerUserId = blockerUserId;
        BlockedUserId = blockedUserId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long BlockerUserId { get; private set; }

    public long BlockedUserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
