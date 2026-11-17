using Juple.Domain.Billing;

namespace Juple.Application.Admin;

public sealed record MembershipUser(long UserId, string JupleId, string? DisplayName, DateTimeOffset? TrialEndsAtUtc);
public sealed record MembershipSearchResult(string JupleId);
public sealed record MembershipGrantRequest(Guid RequestId, string? Kind, DateTimeOffset? StartsAtUtc, DateTimeOffset? EndsAtUtc, string? Reason);
public sealed record MembershipGrantHistory(Guid Id, string Kind, string Status, long GrantedByUserId, DateTimeOffset GrantedAtUtc,
    DateTimeOffset StartsAtUtc, DateTimeOffset? EndsAtUtc, string Reason, long? RevokedByUserId, DateTimeOffset? RevokedAtUtc, string? RevokeReason)
{
    public static MembershipGrantHistory From(MembershipGrant row, DateTimeOffset now) => new(
        row.Id, row.Kind == MembershipGrantKind.Preview ? "preview" : "complimentary",
        row.RevokedAtUtc is not null ? "revoked" : row.EndsAtUtc <= now ? "expired" : row.StartsAtUtc > now ? "scheduled" : "active",
        row.GrantedByUserId, row.GrantedAtUtc, row.StartsAtUtc, row.EndsAtUtc, row.Reason,
        row.RevokedByUserId, row.RevokedAtUtc, row.RevokeReason);
}

public enum MembershipWriteResult { Saved, Missing, Forbidden, Conflict }

public interface IAdminMembershipStore
{
    Task<MembershipUser?> FindUserAsync(long? userId, string? jupleId, CancellationToken cancellationToken);
    Task<IReadOnlyList<MembershipSearchResult>> SearchUsersAsync(string jupleIdFragment, int limit, CancellationToken cancellationToken);
    Task<IReadOnlyList<MembershipGrant>> HistoryAsync(long userId, CancellationToken cancellationToken);
    Task<MembershipWriteResult> GrantAsync(MembershipGrant grant, CancellationToken cancellationToken);
    Task<MembershipWriteResult> RevokeAsync(long actorId, long userId, Guid grantId, DateTimeOffset now, string reason, CancellationToken cancellationToken);
}
