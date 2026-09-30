using Juple.Application.Collections.NotificationPreference;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionNotificationPreferenceStore(JupleDbContext dbContext) : ICollectionNotificationPreferenceStore
{
    public async Task<bool?> FindNewItemNotificationsAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        await dbContext.CollectionNotificationPreferences.AsNoTracking()
            .Where(preference => preference.CollectionId == collectionId && preference.UserId == userId)
            .Select(preference => (bool?)preference.NewItemNotificationsEnabled)
            .FirstOrDefaultAsync(cancellationToken);

    public async Task SetNewItemNotificationsAsync(
        long userId, long collectionId, bool enabled, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default)
    {
        if (await UpdateAsync(userId, collectionId, enabled, updatedAtUtc, cancellationToken))
        {
            return;
        }

        var preference = new CollectionNotificationPreference(collectionId, userId, enabled, updatedAtUtc);
        dbContext.CollectionNotificationPreferences.Add(preference);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent first write created the row - apply this (later) choice over it.
            dbContext.Entry(preference).State = EntityState.Detached;
            await UpdateAsync(userId, collectionId, enabled, updatedAtUtc, cancellationToken);
        }
    }

    private async Task<bool> UpdateAsync(long userId, long collectionId, bool enabled, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken) =>
        await dbContext.CollectionNotificationPreferences
            .Where(preference => preference.CollectionId == collectionId && preference.UserId == userId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(preference => preference.NewItemNotificationsEnabled, enabled)
                    .SetProperty(preference => preference.UpdatedAtUtc, updatedAtUtc),
                cancellationToken) > 0;
}
