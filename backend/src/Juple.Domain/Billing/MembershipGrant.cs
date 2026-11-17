namespace Juple.Domain.Billing;

public enum MembershipGrantKind { Preview, Complimentary }

/// <summary>An operator grant, independent of store ownership and trial eligibility. A null end is only valid for preview.</summary>
public sealed class MembershipGrant
{
    private MembershipGrant() { }

    public MembershipGrant(Guid id, long userId, MembershipGrantKind kind, long adminUserId, DateTimeOffset now,
        DateTimeOffset startsAtUtc, DateTimeOffset? endsAtUtc, string reason)
    {
        Id = id;
        UserId = userId;
        Kind = kind;
        GrantedByUserId = adminUserId;
        GrantedAtUtc = now;
        StartsAtUtc = startsAtUtc;
        EndsAtUtc = endsAtUtc;
        Reason = reason;
    }

    public Guid Id { get; private init; }
    public long UserId { get; private init; }
    public MembershipGrantKind Kind { get; private init; }
    public long GrantedByUserId { get; private init; }
    public DateTimeOffset GrantedAtUtc { get; private init; }
    public DateTimeOffset StartsAtUtc { get; private init; }
    public DateTimeOffset? EndsAtUtc { get; private init; }
    public string Reason { get; private init; } = null!;
    public DateTimeOffset? RevokedAtUtc { get; private set; }
    public long? RevokedByUserId { get; private set; }
    public string? RevokeReason { get; private set; }

    public void Revoke(long adminUserId, DateTimeOffset now, string reason)
    {
        RevokedAtUtc = now;
        RevokedByUserId = adminUserId;
        RevokeReason = reason;
    }
}

public readonly record struct ComplimentaryAccess(DateTimeOffset? ActiveUntilUtc, DateTimeOffset? LastEndedAtUtc);
