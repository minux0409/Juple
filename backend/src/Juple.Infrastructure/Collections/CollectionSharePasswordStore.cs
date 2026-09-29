using Juple.Application.Collections.SharePassword;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionSharePasswordStore(JupleDbContext dbContext) : ICollectionSharePasswordStore
{
    public async Task<CollectionSharePasswordRecord?> GetAsync(long collectionId, CancellationToken cancellationToken = default) =>
        await dbContext.CollectionSharePasswords
            .AsNoTracking()
            .Where(sharePassword => sharePassword.CollectionId == collectionId)
            .Select(sharePassword => new CollectionSharePasswordRecord(
                sharePassword.CollectionId,
                sharePassword.Mode,
                sharePassword.PasswordHash,
                sharePassword.EncryptedPassword,
                sharePassword.PasswordVersion,
                sharePassword.UpdatedAtUtc))
            .FirstOrDefaultAsync(cancellationToken);

    public async Task SetAsync(
        long collectionId,
        string passwordHash,
        string encryptedPassword,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var existing = await dbContext.CollectionSharePasswords
            .FirstOrDefaultAsync(sharePassword => sharePassword.CollectionId == collectionId, cancellationToken);
        if (existing is not null)
        {
            existing.SetPassword(passwordHash, encryptedPassword, nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
            return;
        }

        dbContext.CollectionSharePasswords.Add(CollectionSharePassword.Create(collectionId, passwordHash, encryptedPassword, nowUtc));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent first set took the Collection's one slot: apply this one on top (the later write wins).
            dbContext.ChangeTracker.Clear();
            var winner = await dbContext.CollectionSharePasswords
                .FirstAsync(sharePassword => sharePassword.CollectionId == collectionId, cancellationToken);
            winner.SetPassword(passwordHash, encryptedPassword, nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task RemoveAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var existing = await dbContext.CollectionSharePasswords
            .FirstOrDefaultAsync(sharePassword => sharePassword.CollectionId == collectionId, cancellationToken);
        if (existing is null)
        {
            return;
        }

        existing.Remove(nowUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
    }
}
