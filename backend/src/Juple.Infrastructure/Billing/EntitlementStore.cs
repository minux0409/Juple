using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Domain.Billing;
using Juple.Domain.Identity;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Billing;

public sealed class EntitlementStore(JupleDbContext dbContext) : IEntitlementStore
{
    public Task<EntitlementUserState?> GetUserStateAsync(long userId, CancellationToken cancellationToken = default) =>
        QueryState(user => user.Id == userId, cancellationToken);

    public Task<EntitlementUserState?> GetUserStateAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken = default) =>
        QueryState(
            user => dbContext.Set<ExternalIdentity>().Any(identity =>
                identity.UserId == user.Id && identity.TenantId == externalIdentity.TenantId && identity.ObjectId == externalIdentity.ObjectId),
            cancellationToken);

    private async Task<EntitlementUserState?> QueryState(
        System.Linq.Expressions.Expression<Func<Juple.Domain.Users.User, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var row = await dbContext.Users.AsNoTracking()
            .Where(predicate)
            .Select(user => new
            {
                user.Id,
                user.CreatedAtUtc,
                user.TrialStartedAtUtc,
                user.TrialEndsAtUtc,
                Identity = dbContext.Set<ExternalIdentity>()
                    .Where(identity => identity.UserId == user.Id)
                    .Select(identity => new { identity.TenantId, identity.ObjectId })
                    .FirstOrDefault(),
            })
            .SingleOrDefaultAsync(cancellationToken);

        return row is null
            ? null
            : new EntitlementUserState(
                row.Id,
                row.CreatedAtUtc,
                row.TrialStartedAtUtc,
                row.TrialEndsAtUtc,
                row.Identity is null ? null : new ExternalIdentityPrincipal(row.Identity.TenantId, row.Identity.ObjectId));
    }

    public async Task<TrialWindow> EnsureTrialAsync(
        long userId,
        byte[] identityHash,
        TrialWindow newWindow,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var ledger = await FindLedgerAsync(identityHash, cancellationToken);
        var window = newWindow;
        if (ledger is null)
        {
            dbContext.Set<TrialLedgerEntry>().Add(new TrialLedgerEntry(identityHash, newWindow.StartedAtUtc, newWindow.EndsAtUtc, nowUtc));
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
            catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                // A concurrent first call won the race for the same identity: its window is THE window.
                dbContext.ChangeTracker.Clear();
                var winner = await FindLedgerAsync(identityHash, cancellationToken);
                if (winner is null)
                {
                    throw;
                }

                window = new TrialWindow(winner.TrialStartedAtUtc, winner.TrialEndsAtUtc);
            }
        }
        else
        {
            // Already given before (e.g. this is a re-created account): the ORIGINAL window, never a fresh 30 days.
            window = new TrialWindow(ledger.TrialStartedAtUtc, ledger.TrialEndsAtUtc);
        }

        // Project the settled window onto the account - only while it has none, in one statement, so racing callers
        // (or a retry after a crash between the two writes) can never write two different windows.
        await dbContext.Users
            .Where(user => user.Id == userId && user.TrialStartedAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(user => user.TrialStartedAtUtc, window.StartedAtUtc)
                    .SetProperty(user => user.TrialEndsAtUtc, window.EndsAtUtc),
                cancellationToken);
        return window;
    }

    private Task<TrialLedgerEntry?> FindLedgerAsync(byte[] identityHash, CancellationToken cancellationToken) =>
        dbContext.Set<TrialLedgerEntry>().AsNoTracking()
            .Where(entry => entry.IdentityHash == identityHash)
            .SingleOrDefaultAsync(cancellationToken);
}
