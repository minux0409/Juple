using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Collections;
using Juple.Domain.Identity;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.BootstrapCurrentUser;

public sealed class CurrentUserProvisioningStore(JupleDbContext dbContext)
    : ICurrentUserProvisioningStore
{
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
            var user = new User(
                data.PreferredLocale,
                data.TimeZoneId,
                data.DefaultCurrencyCode,
                data.CreatedAtUtc,
                data.CreatedAtUtc,
                UserPlan.Free);
            dbContext.Set<User>().Add(user);
            await dbContext.SaveChangesAsync(cancellationToken);

            // One-time default-Category seed for brand-new users only (see DefaultCollectionSeed) -
            // inserted in the same transaction as the User row so it either lands atomically with
            // the new user or not at all (including on the race-recovery path below, which rolls
            // back this whole transaction wholesale rather than partially committing it).
            foreach (var name in DefaultCollectionSeed.NamesFor(data.PreferredLocale))
            {
                // Fixed literal names we control, not user input - CollectionNameNormalizer's
                // normalization is inlined here (trim+uppercase) since it's `internal` to
                // Juple.Application and this store intentionally doesn't take a dependency on an
                // Application-layer service (see the seeding design note in the UI refactor plan).
                dbContext.Set<Collection>().Add(
                    new Collection(user.Id, name, name.Trim().ToUpperInvariant(), data.CreatedAtUtc));
            }
            await dbContext.SaveChangesAsync(cancellationToken);

            dbContext.Set<ExternalIdentity>().Add(new ExternalIdentity(
                user.Id,
                data.ExternalIdentity.TenantId,
                data.ExternalIdentity.ObjectId,
                data.CreatedAtUtc));
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

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
