using Juple.Application.Admin;
using Juple.Domain.Admin;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Admin;

/// <summary>admin.MobileVersionPolicies: at most one row per platform, each save checked against its rowversion and audited.</summary>
public sealed class MobileVersionPolicyStore(JupleDbContext dbContext) : IMobileVersionPolicyStore
{
    public async Task<IReadOnlyList<StoredMobileVersionPolicy>> ListAsync(CancellationToken cancellationToken = default)
    {
        var rows = await dbContext.MobileVersionPolicySettings.AsNoTracking().ToListAsync(cancellationToken);
        return rows.Select(ToStored).ToList();
    }

    public async Task<StoredMobileVersionPolicy?> GetAsync(string platform, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.MobileVersionPolicySettings.AsNoTracking()
            .SingleOrDefaultAsync(setting => setting.Platform == platform, cancellationToken);
        return row is null ? null : ToStored(row);
    }

    public async Task<StoredMobileVersionPolicy> SaveAsync(
        long adminUserId,
        string platform,
        string? expectedVersion,
        MobileBuildPolicy builds,
        string auditDetail,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        // The grant is re-read inside the write, as the other audited admin writes do: a grant deactivated mid-request writes nothing.
        if (!await dbContext.AdminUsers.AnyAsync(admin => admin.UserId == adminUserId && admin.IsActive, cancellationToken))
        {
            throw new UnauthorizedAccessException();
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var row = await dbContext.MobileVersionPolicySettings.SingleOrDefaultAsync(setting => setting.Platform == platform, cancellationToken);
        if (expectedVersion is null)
        {
            if (row is not null)
            {
                throw new MobileVersionPolicyConflictException();
            }

            row = new MobileVersionPolicySetting(platform, builds.LatestBuild, builds.MinimumSupportedBuild, adminUserId, nowUtc);
            dbContext.MobileVersionPolicySettings.Add(row);
        }
        else
        {
            if (row is null || !string.Equals(Convert.ToBase64String(row.Version), expectedVersion, StringComparison.Ordinal))
            {
                throw new MobileVersionPolicyConflictException();
            }

            // The rowversion is the concurrency token, so a save that lost the race since this read fails at SaveChanges.
            dbContext.Entry(row).Property(setting => setting.Version).OriginalValue = Convert.FromBase64String(expectedVersion);
            row.Change(builds.LatestBuild, builds.MinimumSupportedBuild, adminUserId, nowUtc);
        }

        dbContext.AdminAuditLogs.Add(new AdminAuditLog(
            adminUserId,
            AdminAuditActions.MobileVersionPolicyUpdated,
            AdminAuditTargets.MobileVersionPolicy,
            platform,
            auditDetail,
            nowUtc));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            throw new MobileVersionPolicyConflictException();
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2627 or 2601 })
        {
            // Two first saves of the same platform: the primary key lets exactly one of them in.
            throw new MobileVersionPolicyConflictException();
        }

        return ToStored(row);
    }

    private static StoredMobileVersionPolicy ToStored(MobileVersionPolicySetting row) => new(
        row.Platform,
        row.LatestBuild,
        row.MinimumSupportedBuild,
        row.UpdatedByAdminUserId,
        row.UpdatedAtUtc,
        Convert.ToBase64String(row.Version));
}
