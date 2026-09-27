using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionLockStore(JupleDbContext dbContext) : ICollectionLockStore
{
    /// <summary>
    /// One query: the Collection's lock fields plus its Owner's lock password, if they have one;
    /// CollectionLockPasswordSource decides which one opens it.
    /// </summary>
    public async Task<CollectionLockState?> GetStateAsync(long collectionId, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.Collections
            .AsNoTracking()
            .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null)
            .Select(collection => new
            {
                collection.Id,
                collection.IsLocked,
                collection.LockPasswordHash,
                collection.LockVersion,
                OwnerPasswordHash = dbContext.UserCollectionLockSettings
                    .Where(settings => settings.UserId == collection.UserId)
                    .Select(settings => settings.PasswordHash)
                    .FirstOrDefault(),
            })
            .FirstOrDefaultAsync(cancellationToken);
        if (row is null)
        {
            return null;
        }

        var (passwordHash, usesOwnerPassword) = CollectionLockPasswordSource.Resolve(row.LockPasswordHash, row.OwnerPasswordHash);
        return new CollectionLockState(row.Id, row.IsLocked, passwordHash, row.LockVersion, usesOwnerPassword);
    }

    public async Task LockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var collection = await LoadAsync(collectionId, cancellationToken);
        collection.Lock(nowUtc);
        await SaveAsync(cancellationToken);
    }

    public async Task RemoveLockAsync(long collectionId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var collection = await LoadAsync(collectionId, cancellationToken);
        collection.RemoveLock(nowUtc);
        await SaveAsync(cancellationToken);
    }

    public async Task<DateTimeOffset?> GetBlockedUntilAsync(
        long collectionId,
        string subjectKey,
        int maxFailures,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        var throttle = await dbContext.CollectionUnlockThrottles
            .AsNoTracking()
            .FirstOrDefaultAsync(
                entry => entry.CollectionId == collectionId && entry.SubjectKey == subjectKey, cancellationToken);
        return throttle?.BlockedUntil(nowUtc, maxFailures);
    }

    public async Task RecordFailureAsync(
        long collectionId,
        string subjectKey,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        // Read-modify-write under an update lock so concurrent wrong guesses (possibly on different
        // replicas) are all counted instead of overwriting each other.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var throttle = await dbContext.CollectionUnlockThrottles
            .FromSqlInterpolated($"SELECT * FROM collections.CollectionUnlockThrottles WITH (UPDLOCK, HOLDLOCK) WHERE CollectionId = {collectionId} AND SubjectKey = {subjectKey}")
            .FirstOrDefaultAsync(cancellationToken);
        if (throttle is null)
        {
            throttle = new CollectionUnlockThrottle(collectionId, subjectKey, nowUtc);
            dbContext.CollectionUnlockThrottles.Add(throttle);
        }

        throttle.RecordFailure(nowUtc);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent first failure created the row; count this one on it.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            var existing = await dbContext.CollectionUnlockThrottles.FirstAsync(
                entry => entry.CollectionId == collectionId && entry.SubjectKey == subjectKey, cancellationToken);
            existing.RecordFailure(nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }
    }

    public async Task ResetFailuresAsync(
        long collectionId,
        string subjectKey,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await dbContext.CollectionUnlockThrottles
            .Where(entry => entry.CollectionId == collectionId && entry.SubjectKey == subjectKey)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private async Task<Collection> LoadAsync(long collectionId, CancellationToken cancellationToken) =>
        await dbContext.Collections.FirstOrDefaultAsync(
            collection => collection.Id == collectionId && collection.DeletedAtUtc == null, cancellationToken)
        ?? throw new CollectionNotFoundException();

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }
    }
}
