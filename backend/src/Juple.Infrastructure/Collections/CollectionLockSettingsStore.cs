using Juple.Application.Collections;
using Juple.Application.Collections.Locking;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>The user's one Collection lock password (see UserCollectionLockSettings).</summary>
public sealed class CollectionLockSettingsStore(JupleDbContext dbContext) : ICollectionLockSettingsStore
{
    public async Task<CollectionLockPasswordStatusDto> GetStatusAsync(long userId, CancellationToken cancellationToken = default)
    {
        var changedAtUtc = await dbContext.UserCollectionLockSettings
            .AsNoTracking()
            .Where(settings => settings.UserId == userId)
            .Select(settings => (DateTimeOffset?)settings.PasswordChangedAtUtc)
            .FirstOrDefaultAsync(cancellationToken);
        return new CollectionLockPasswordStatusDto(changedAtUtc is not null, changedAtUtc);
    }

    public async Task<CollectionLockPasswordRecord?> GetAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var settings = await dbContext.UserCollectionLockSettings
            .AsNoTracking()
            .FirstOrDefaultAsync(entry => entry.UserId == userId, cancellationToken);
        return settings is null ? null : new CollectionLockPasswordRecord(settings.PasswordHash, settings.ChangeBlockedUntil(nowUtc));
    }

    public async Task RecordFailedChangeAsync(long userId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        // Read-modify-write under an update lock so concurrent wrong guesses (possibly on different
        // replicas) are all counted instead of overwriting each other.
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        var settings = await LockRowAsync(userId, cancellationToken);
        if (settings is null)
        {
            return;
        }

        settings.RecordFailedChange(nowUtc);
        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task SetPasswordAsync(long userId, string passwordHash, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        // UPDLOCK+HOLDLOCK also range-locks a missing key, so two concurrent first setups serialize
        // instead of racing to insert.
        var settings = await LockRowAsync(userId, cancellationToken);
        if (settings is null)
        {
            dbContext.UserCollectionLockSettings.Add(new UserCollectionLockSettings(userId, passwordHash, nowUtc));
        }
        else
        {
            settings.ReplacePassword(passwordHash, nowUtc);
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException exception)
        {
            throw new CollectionConcurrencyException(exception);
        }

        // Every grant embeds the LockVersion it was issued for - bumping it on each locked Collection
        // of this Owner revokes every outstanding grant (members' and public links' too).
        await dbContext.Collections
            .Where(collection => collection.UserId == userId && collection.IsLocked)
            .ExecuteUpdateAsync(
                setters => setters.SetProperty(collection => collection.LockVersion, collection => collection.LockVersion + 1),
                cancellationToken);

        // The Owner just proved who they are - their own failed-unlock counters start over.
        var ownerThrottleKey = CollectionUnlockSubject.ForUser(userId).ThrottleKey;
        await dbContext.CollectionUnlockThrottles
            .Where(entry => entry.SubjectKey == ownerThrottleKey
                && dbContext.Collections.Any(collection => collection.Id == entry.CollectionId && collection.UserId == userId))
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
    }

    private Task<UserCollectionLockSettings?> LockRowAsync(long userId, CancellationToken cancellationToken) =>
        dbContext.UserCollectionLockSettings
            .FromSqlInterpolated($"SELECT * FROM collections.UserCollectionLockSettings WITH (UPDLOCK, HOLDLOCK) WHERE UserId = {userId}")
            .FirstOrDefaultAsync(cancellationToken);
}
