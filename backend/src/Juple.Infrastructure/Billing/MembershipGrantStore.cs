using System.Globalization;
using Juple.Application.Admin;
using Juple.Application.Billing;
using Juple.Domain.Admin;
using Juple.Domain.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

public sealed class MembershipGrantStore(JupleDbContext dbContext) : IAdminMembershipStore, IMembershipGrantReader
{
    private IQueryable<MembershipGrant> ForUser(long userId) => dbContext.Set<MembershipGrant>().Where(row => row.UserId == userId);

    public Task<MembershipUser?> FindUserAsync(long? userId, string? jupleId, CancellationToken cancellationToken) =>
        dbContext.Users.AsNoTracking().Where(user => userId != null ? user.Id == userId : user.PublicCode == jupleId)
            .Select(user => new MembershipUser(user.Id, user.PublicCode, user.DisplayName, user.TrialEndsAtUtc))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<MembershipSearchResult>> SearchUsersAsync(string jupleIdFragment, int limit, CancellationToken cancellationToken) =>
        await dbContext.Users.AsNoTracking()
            .Where(user => user.PublicCode.Contains(jupleIdFragment))
            .OrderBy(user => user.PublicCode)
            .Select(user => new MembershipSearchResult(user.PublicCode))
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<MembershipGrant>> HistoryAsync(long userId, CancellationToken cancellationToken) =>
        await ForUser(userId).AsNoTracking().OrderByDescending(row => row.GrantedAtUtc).ThenBy(row => row.Id).ToListAsync(cancellationToken);

    public Task<bool> HasPreviewAsync(long userId, CancellationToken cancellationToken) =>
        ForUser(userId).AnyAsync(row => row.Kind == MembershipGrantKind.Preview && row.RevokedAtUtc == null, cancellationToken);

    public async Task<ComplimentaryAccess> GetComplimentaryAsync(long userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var windows = await ForUser(userId).AsNoTracking()
            .Where(row => row.Kind == MembershipGrantKind.Complimentary && row.StartsAtUtc <= now)
            .Select(row => new { Start = row.StartsAtUtc > row.GrantedAtUtc ? row.StartsAtUtc : row.GrantedAtUtc,
                End = row.RevokedAtUtc != null && row.RevokedAtUtc < row.EndsAtUtc ? row.RevokedAtUtc.Value : row.EndsAtUtc!.Value })
            .ToListAsync(cancellationToken);
        // A scheduled grant revoked before it began never provided access.
        var validEnds = windows.Where(row => row.Start < row.End).Select(row => row.End).ToList();
        return new(validEnds.Where(end => end > now).Select(end => (DateTimeOffset?)end).Max(),
            validEnds.Where(end => end <= now).Select(end => (DateTimeOffset?)end).Max());
    }

    public async Task<MembershipWriteResult> GrantAsync(MembershipGrant grant, CancellationToken cancellationToken)
    {
        if (grant.GrantedByUserId == grant.UserId && grant.Kind != MembershipGrantKind.Preview)
        {
            return MembershipWriteResult.Forbidden;
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var gate = await LockTargetAsync(grant.GrantedByUserId, grant.UserId, cancellationToken);
        if (gate != MembershipWriteResult.Saved)
        {
            return gate;
        }

        var existing = await ForUser(grant.UserId).SingleOrDefaultAsync(row => row.Id == grant.Id, cancellationToken);
        if (existing is not null)
        {
            return existing.Kind == grant.Kind && existing.GrantedByUserId == grant.GrantedByUserId
                && existing.Reason == grant.Reason && existing.EndsAtUtc == grant.EndsAtUtc
                && (grant.Kind == MembershipGrantKind.Preview || existing.StartsAtUtc == grant.StartsAtUtc)
                ? MembershipWriteResult.Saved : MembershipWriteResult.Conflict;
        }

        var outstanding = ForUser(grant.UserId).Where(row => row.Kind == grant.Kind && row.RevokedAtUtc == null);
        if (grant.Kind == MembershipGrantKind.Preview && await outstanding.AnyAsync(cancellationToken))
        {
            return MembershipWriteResult.Conflict;
        }
        if (grant.Kind == MembershipGrantKind.Complimentary && (grant.EndsAtUtc <= grant.GrantedAtUtc
            || await outstanding.AnyAsync(row => row.StartsAtUtc < grant.EndsAtUtc
                && row.EndsAtUtc > grant.StartsAtUtc && row.EndsAtUtc > grant.GrantedAtUtc, cancellationToken)))
        {
            return MembershipWriteResult.Conflict;
        }

        dbContext.Set<MembershipGrant>().Add(grant);
        Audit(grant.GrantedByUserId, grant, "membership.granted", grant.GrantedAtUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException ex) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(ex))
        {
            return MembershipWriteResult.Conflict;
        }
        return MembershipWriteResult.Saved;
    }

    public async Task<MembershipWriteResult> RevokeAsync(long actorId, long userId, Guid grantId, DateTimeOffset now, string reason, CancellationToken cancellationToken)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var gate = await LockTargetAsync(actorId, userId, cancellationToken);
        if (gate != MembershipWriteResult.Saved)
        {
            return gate;
        }

        var row = await ForUser(userId).SingleOrDefaultAsync(grant => grant.Id == grantId, cancellationToken);
        if (row is null)
        {
            return MembershipWriteResult.Missing;
        }
        if (actorId == userId && row.Kind != MembershipGrantKind.Preview)
        {
            return MembershipWriteResult.Forbidden;
        }
        if (row.RevokedAtUtc is null && !(row.EndsAtUtc <= now))
        {
            row.Revoke(actorId, now, reason);
            Audit(actorId, row, "membership.revoked", now);
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        return MembershipWriteResult.Saved;
    }

    private async Task<MembershipWriteResult> LockTargetAsync(long actorId, long userId, CancellationToken cancellationToken)
    {
        if (!await dbContext.AdminUsers
                .FromSqlInterpolated($"SELECT * FROM [admin].[AdminUsers] WITH (HOLDLOCK) WHERE [UserId] = {actorId}")
                .AnyAsync(admin => admin.IsActive && admin.Role == AdminRole.Owner, cancellationToken))
        {
            return MembershipWriteResult.Forbidden;
        }

        var exists = await dbContext.Users
            .FromSqlInterpolated($"SELECT * FROM [users].[Users] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {userId}")
            .AnyAsync(cancellationToken);
        return exists ? MembershipWriteResult.Saved : MembershipWriteResult.Missing;
    }

    private void Audit(long actorId, MembershipGrant grant, string action, DateTimeOffset now) =>
        dbContext.AdminAuditLogs.Add(new AdminAuditLog(actorId, action, "MembershipUser",
            grant.UserId.ToString(CultureInfo.InvariantCulture), $"{grant.Kind}:{grant.Id:D}", now));
}
