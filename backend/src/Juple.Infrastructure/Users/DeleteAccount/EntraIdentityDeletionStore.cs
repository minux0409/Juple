using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.DeleteAccount;
using Juple.Domain.Billing;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.DeleteAccount;

public sealed class EntraIdentityDeletionStore(JupleDbContext dbContext) : IEntraIdentityDeletionStore
{
    public Task<PendingEntraIdentityDeletion?> FindAsync(long id, CancellationToken cancellationToken = default) =>
        dbContext.Set<PendingEntraIdentityDeletion>().AsNoTracking().Where(task => task.Id == id).FirstOrDefaultAsync(cancellationToken);

    public Task<PendingEntraIdentityDeletion?> FindForIdentityAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default) =>
        dbContext.Set<PendingEntraIdentityDeletion>().AsNoTracking()
            .Where(task => task.TenantId == identity.TenantId && task.ObjectId == identity.ObjectId)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task<IReadOnlyList<long>> ListPendingIdsAsync(int limit, CancellationToken cancellationToken = default) =>
        await dbContext.Set<PendingEntraIdentityDeletion>().AsNoTracking()
            .OrderBy(task => task.Id)
            .Select(task => task.Id)
            .Take(limit)
            .ToListAsync(cancellationToken);

    public async Task CompleteAsync(long id, CancellationToken cancellationToken = default) =>
        await dbContext.Set<PendingEntraIdentityDeletion>().Where(task => task.Id == id).ExecuteDeleteAsync(cancellationToken);

    public async Task RecordFailureAsync(long id, string errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default)
    {
        var code = errorCode.Length > 100 ? errorCode[..100] : errorCode;
        await dbContext.Set<PendingEntraIdentityDeletion>()
            .Where(task => task.Id == id)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(task => task.AttemptCount, task => task.AttemptCount + 1)
                    .SetProperty(task => task.LastAttemptAtUtc, attemptedAtUtc)
                    .SetProperty(task => task.LastErrorCode, code),
                cancellationToken);
    }

    public async Task<EntraIdentityDeletionStats> GetStatsAsync(
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var aggregate = await dbContext.Set<PendingEntraIdentityDeletion>()
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(group => new
            {
                PendingCount = group.Count(),
                OldestCreatedAtUtc = group.Min(task => task.CreatedAtUtc),
                FailedPendingCount = group.Count(task => task.AttemptCount > 0),
                RepeatedFailureCount = group.Count(task => task.AttemptCount > 1),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (aggregate is null)
        {
            return new EntraIdentityDeletionStats(0, null, 0, 0);
        }

        var oldestSeconds = Math.Max(0, (long)(nowUtc - aggregate.OldestCreatedAtUtc).TotalSeconds);
        return new EntraIdentityDeletionStats(
            aggregate.PendingCount,
            oldestSeconds,
            aggregate.FailedPendingCount,
            aggregate.RepeatedFailureCount);
    }
}

/// <summary>
/// Gives a brand-new account the trial window remembered under its email hash (see ITrialIdentityHasher.HashEmail), so deleting
/// the account (which now also deletes the Entra user, and with it the object id the older ledger entry is keyed by) and signing
/// up again cannot restart the 30 days. Same projection rule as EntitlementStore.EnsureTrialAsync: only while the account has none.
/// </summary>
public sealed class TrialEmailLedger(JupleDbContext dbContext) : ITrialEmailLedger
{
    public async Task InheritAsync(ExternalIdentityPrincipal identity, byte[] emailHash, CancellationToken cancellationToken = default)
    {
        var ledger = await dbContext.Set<TrialLedgerEntry>().AsNoTracking()
            .Where(entry => entry.IdentityHash == emailHash)
            .Select(entry => new { entry.TrialStartedAtUtc, entry.TrialEndsAtUtc })
            .FirstOrDefaultAsync(cancellationToken);
        if (ledger is null)
        {
            return;
        }

        await dbContext.Users
            .Where(user => user.TrialStartedAtUtc == null
                && dbContext.Set<Juple.Domain.Identity.ExternalIdentity>().Any(external =>
                    external.UserId == user.Id && external.TenantId == identity.TenantId && external.ObjectId == identity.ObjectId))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(user => user.TrialStartedAtUtc, ledger.TrialStartedAtUtc)
                    .SetProperty(user => user.TrialEndsAtUtc, ledger.TrialEndsAtUtc),
                cancellationToken);
    }
}
