using Juple.Application.Identity;
using Juple.Application.Users.BootstrapCurrentUser;
using Juple.Domain.Identity;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
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
                IsUniqueConstraintViolation(exception),
                transaction.RollbackAsync,
                dbContext.ChangeTracker.Clear,
                cancellationToken => ExternalIdentityExistsAsync(data.ExternalIdentity, cancellationToken),
                cancellationToken);
            return;
        }
    }

    private static bool IsUniqueConstraintViolation(DbUpdateException exception) =>
        exception.InnerException is SqlException sqlException
        && ExternalIdentityRaceRecovery.IsSqlServerUniqueConstraintViolation(sqlException.Number);
}