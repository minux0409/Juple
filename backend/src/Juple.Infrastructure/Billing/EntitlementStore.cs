using Juple.Application.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
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
                user.MembershipTrialStartedAtUtc,
                user.MembershipTrialEndsAtUtc,
                IdentityCount = dbContext.Set<ExternalIdentity>().Count(identity => identity.UserId == user.Id),
                Identity = dbContext.Set<ExternalIdentity>()
                    .Where(identity => identity.UserId == user.Id)
                    .OrderBy(identity => identity.Id)
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
                row.IdentityCount != 1 || row.Identity is null ? null : new ExternalIdentityPrincipal(row.Identity.TenantId, row.Identity.ObjectId),
                row.MembershipTrialStartedAtUtc, row.MembershipTrialEndsAtUtc, row.IdentityCount > 1);
    }

    public async Task<IReadOnlyList<PurchaseAccess>> GetPurchaseAccessAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.UserId == userId)
            .Select(purchase => new PurchaseAccess(purchase.State, purchase.Reason, purchase.AccessEndsAtUtc))
            .ToListAsync(cancellationToken);

    public async Task<IReadOnlyList<OwnedStorePurchase>> GetOwnedPurchasesAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.StorePurchases.AsNoTracking()
            .Where(purchase => purchase.UserId == userId)
            .Select(purchase => new OwnedStorePurchase(purchase.Source, purchase.ProductId, purchase.State, purchase.AccessEndsAtUtc, purchase.AutoRenews, purchase.CurrentPeriodStartUtc, purchase.BasePlanId))
            .ToListAsync(cancellationToken);

    public async Task<TrialWindow> EnsureTrialAsync(
        long userId,
        byte[] identityHash,
        TrialWindow newWindow,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        // The user row is the common serialization point for projection/inheritance and
        // entitlement requests. Re-read after locking: the caller's state can be stale.
        // Keep ledger creation and projection in one transaction, including rollback on error.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var user = await dbContext.Users
            .FromSqlInterpolated($"SELECT * FROM [users].[Users] WITH (UPDLOCK, HOLDLOCK) WHERE [Id] = {userId}")
            .AsNoTracking().SingleOrDefaultAsync(cancellationToken)
            ?? throw new CurrentJupleUserNotFoundException();
        if (user.MembershipTrialStartedAtUtc is { } started && user.MembershipTrialEndsAtUtc is { } ends)
        {
            await transaction.CommitAsync(cancellationToken);
            return new TrialWindow(started, ends);
        }
        var ledger = await FindLedgerAsync(identityHash, cancellationToken);
        var window = newWindow;
        if (ledger is null)
        {
            dbContext.Set<MembershipTrialLedgerEntry>().Add(new MembershipTrialLedgerEntry(identityHash, newWindow.StartedAtUtc, newWindow.EndsAtUtc, nowUtc));
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
            .Where(user => user.Id == userId && user.MembershipTrialStartedAtUtc == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(user => user.MembershipTrialStartedAtUtc, window.StartedAtUtc)
                    .SetProperty(user => user.MembershipTrialEndsAtUtc, window.EndsAtUtc),
                cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return window;
    }

    private Task<MembershipTrialLedgerEntry?> FindLedgerAsync(byte[] identityHash, CancellationToken cancellationToken) =>
        dbContext.Set<MembershipTrialLedgerEntry>().AsNoTracking()
            .Where(entry => entry.IdentityHash == identityHash)
            .SingleOrDefaultAsync(cancellationToken);
}
