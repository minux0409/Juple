using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Identity;
using Juple.Domain.Users;
using Juple.Domain.Billing;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Juple.Infrastructure.Users.DeleteAccount;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.BootstrapCurrentUser;

public sealed class CurrentUserProvisioningStore(JupleDbContext dbContext)
    : ICurrentUserProvisioningStore
{
    public bool CreatedAccount { get; private set; }

    public async Task<UserPlan?> TrySyncTimeZoneAndGetPlanAsync(
        ExternalIdentityPrincipal externalIdentity,
        string timeZoneId,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default)
    {
        var user = await (
            from identity in dbContext.Set<ExternalIdentity>()
            join existingUser in dbContext.Users on identity.UserId equals existingUser.Id
            where identity.TenantId == externalIdentity.TenantId
                && identity.ObjectId == externalIdentity.ObjectId
            select existingUser)
            .SingleOrDefaultAsync(cancellationToken);

        if (user is null)
        {
            return null;
        }

        if (!string.Equals(user.TimeZoneId, timeZoneId, StringComparison.Ordinal))
        {
            user.UpdateTimeZone(timeZoneId, updatedAtUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return user.Plan;
    }

    public async Task<UserPlan> CreateAsync(
        CurrentUserBootstrapData data,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);

        try
        {
            if (data.TrialEmailHash is { } hash)
                await MembershipTrialSqlLock.AcquireAsync(dbContext, hash, cancellationToken);
            var user = new User(
                data.PreferredLocale,
                data.TimeZoneId,
                data.DefaultCurrencyCode,
                data.CreatedAtUtc,
                data.CreatedAtUtc,
                UserPlan.Free);

            // The constructor already drew a random Juple ID; redraw on the (≈1 in 10^11 per
            // existing user) chance it is taken. UX_Users_PublicCode remains the final guarantee.
            for (var attempt = 0;
                 attempt < 5 && await dbContext.Set<User>().AnyAsync(existing => existing.PublicCode == user.PublicCode, cancellationToken);
                 attempt++)
            {
                user.RegeneratePublicCodeBeforeCreate();
            }

            dbContext.Set<User>().Add(user);
            await dbContext.SaveChangesAsync(cancellationToken);

            // A new user starts with no Collections at all: the former one-time default seed (Wishlist / Food / Movies) was removed.
            // Existing users' Collections are never touched - nothing here reads or deletes them.

            dbContext.Set<ExternalIdentity>().Add(new ExternalIdentity(
                user.Id,
                data.ExternalIdentity.TenantId,
                data.ExternalIdentity.ObjectId,
                data.CreatedAtUtc));
            await dbContext.SaveChangesAsync(cancellationToken);
            // Publish User + ExternalIdentity + remembered trial projections in ONE commit.
            // A competing bootstrap either sees no account (and loses the identity unique-key
            // race), or sees the fully inherited account. It never sees an unsettled returnee.
            if (data.TrialEmailHash is { } emailHash)
            {
                await new TrialEmailLedger(dbContext).InheritAsync(data.ExternalIdentity, emailHash, cancellationToken);
            }
            if (data.OfficialTrialWindow is { } candidate && data.TrialIdentityHash is { } identityHash)
            {
                await SettleOfficialTrialAsync(user.Id, identityHash, data.TrialEmailHash, candidate, data.CreatedAtUtc, cancellationToken);
            }
            await transaction.CommitAsync(cancellationToken);

            CreatedAccount = true;
            return UserPlan.Free;
        }
        catch (DbUpdateException exception)
        {
            UserPlan? recoveredPlan = null;
            await ExternalIdentityRaceRecovery.RecoverOrRethrowAsync(
                exception,
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception),
                transaction.RollbackAsync,
                dbContext.ChangeTracker.Clear,
                async raceCancellationToken =>
                {
                    recoveredPlan = await FindPlanOnlyAsync(data.ExternalIdentity, raceCancellationToken);
                    return recoveredPlan is not null;
                },
                cancellationToken);

            // RecoverOrRethrowAsync only returns (rather than rethrowing) once the lookup above has
            // returned true, i.e. recoveredPlan is guaranteed non-null here - the ?? fallback is
            // just defensive, never actually exercised.
            return recoveredPlan ?? UserPlan.Free;
        }
    }

    private async Task SettleOfficialTrialAsync(long userId, byte[] identityHash, byte[]? emailHash,
        TrialWindow candidate, DateTimeOffset now, CancellationToken ct)
    {
        var ledger = dbContext.Set<MembershipTrialLedgerEntry>();
        var identity = await ledger.AsNoTracking().SingleOrDefaultAsync(row => row.IdentityHash == identityHash, ct);
        var email = emailHash is null ? null : await ledger.AsNoTracking().SingleOrDefaultAsync(row => row.IdentityHash == emailHash, ct);
        if (identity is not null && email is not null &&
            (identity.TrialStartedAtUtc != email.TrialStartedAtUtc || identity.TrialEndsAtUtc != email.TrialEndsAtUtc))
            throw new InvalidOperationException("Conflicting official trial records require review.");
        var remembered = email ?? identity;
        var window = remembered is null ? candidate : new TrialWindow(remembered.TrialStartedAtUtc, remembered.TrialEndsAtUtc);
        if (identity is null)
            ledger.Add(new(identityHash, window.StartedAtUtc, window.EndsAtUtc, now));
        if (emailHash is not null && email is null)
            ledger.Add(new(emailHash, window.StartedAtUtc, window.EndsAtUtc, now));
        await dbContext.SaveChangesAsync(ct);
        await dbContext.Users.Where(row => row.Id == userId && row.MembershipTrialStartedAtUtc == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(row => row.MembershipTrialStartedAtUtc, window.StartedAtUtc)
                .SetProperty(row => row.MembershipTrialEndsAtUtc, window.EndsAtUtc), ct);
    }

    /// <summary>
    /// Plan-only lookup used solely by the race-recovery path above - no timezone sync there, since
    /// the concurrent call that actually won the race already ran its own full bootstrap (including
    /// any timezone sync a *future* call would perform).
    /// </summary>
    private async Task<UserPlan?> FindPlanOnlyAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken)
    {
        var match = await (
            from identity in dbContext.Set<ExternalIdentity>()
            join user in dbContext.Set<User>() on identity.UserId equals user.Id
            where identity.TenantId == externalIdentity.TenantId && identity.ObjectId == externalIdentity.ObjectId
            select new { user.Plan }
        ).FirstOrDefaultAsync(cancellationToken);

        return match?.Plan;
    }
}
