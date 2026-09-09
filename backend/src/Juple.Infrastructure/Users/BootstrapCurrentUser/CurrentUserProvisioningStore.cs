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
    public Task<bool> ExternalIdentityExistsAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default) =>
        dbContext.Set<ExternalIdentity>().AnyAsync(
            identity => identity.TenantId == externalIdentity.TenantId
                && identity.ObjectId == externalIdentity.ObjectId,
            cancellationToken);

    public async Task CreateOrGetAsync(
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
                data.CreatedAtUtc);
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
        }
        catch (DbUpdateException exception)
        {
            await ExternalIdentityRaceRecovery.RecoverOrRethrowAsync(
                exception,
                SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception),
                transaction.RollbackAsync,
                dbContext.ChangeTracker.Clear,
                cancellationToken => ExternalIdentityExistsAsync(data.ExternalIdentity, cancellationToken),
                cancellationToken);
            return;
        }
    }
}