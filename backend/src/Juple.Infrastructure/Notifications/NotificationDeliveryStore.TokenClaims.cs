using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Push;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

public sealed partial class NotificationDeliveryStore
{
    public async Task<PushDeliveryClaims> TryClaimTokenGroupsAsync(
        IReadOnlyCollection<PushDeliveryTarget> targets, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (targets.Count == 0) return new([], new HashSet<long>());
        if (dbContext.Database.CurrentTransaction is not null)
            throw new InvalidOperationException("Push claims require a short independent transaction.");

        var groups = targets.GroupBy(target => (target.Notification.Id, target.Notification.UserId,
            target.Device.Platform, target.Device.PushToken)).ToList();
        await using var transaction = await dbContext.Database.BeginTransactionAsync(cancellationToken);
        // Registration uses the same token locks. No network call occurs while the transaction
        // is open; committed Sending leases coordinate the later provider calls across replicas.
        await PushRegistrationSql.LockAsync(dbContext,
            groups.Select(group => PushRegistrationSql.TokenLock(group.Key.Platform, group.Key.PushToken)), cancellationToken);

        var userIds = groups.Select(group => group.Key.UserId).Distinct().ToList();
        var notificationIds = groups.Select(group => group.Key.Id).Distinct().ToList();
        // Explicit original-schema projection: no APNs environment or computed token-hash column.
        var registrations = await dbContext.PushDeviceRegistrations.AsNoTracking()
            .Where(row => userIds.Contains(row.UserId))
            .Select(row => new { row.Id, row.UserId, row.Platform, row.PushToken, row.IsEnabled })
            .ToListAsync(cancellationToken);
        var outcomes = await dbContext.NotificationDeliveries.Where(row => notificationIds.Contains(row.NotificationId))
            .ToListAsync(cancellationToken);
        var byKey = outcomes.ToDictionary(row => new DeliveryKey(row.NotificationId, row.PushDeviceRegistrationId));
        var pending = new HashSet<long>();
        var candidates = new List<ClaimedPushDelivery>();
        foreach (var group in groups)
        {
            var aliases = registrations.Where(row => row.UserId == group.Key.UserId && row.Platform == group.Key.Platform
                && string.Equals(row.PushToken, group.Key.PushToken, StringComparison.Ordinal)).ToList();
            var keys = aliases.Select(row => new DeliveryKey(group.Key.Id, row.Id)).ToList();
            var rows = keys.Where(byKey.ContainsKey).Select(key => byKey[key]).ToList();
            var sent = rows.FirstOrDefault(row => row.Status == NotificationDeliveryStatus.Sent);
            if (sent is not null)
            {
                // Carry an already successful token outcome to a newly discovered alias. This
                // is not another provider attempt (zero claims on an added history row).
                foreach (var key in keys)
                {
                    if (byKey.TryGetValue(key, out var row))
                    {
                        if (row.Status != NotificationDeliveryStatus.Sent)
                            row.RecordAttempt(NotificationDeliveryStatus.Sent, sent.AttemptedAtUtc, sent.ProviderMessageId, null);
                    }
                    else
                        dbContext.NotificationDeliveries.Add(new NotificationDelivery(key.NotificationId, key.PushDeviceRegistrationId,
                            NotificationDeliveryStatus.Sent, 0, sent.AttemptedAtUtc, sent.ProviderMessageId, null));
                }
                continue;
            }
            if (rows.Any(row => row.Status == NotificationDeliveryStatus.Sending && row.AttemptedAtUtc > nowUtc - StaleSendingLeaseTimeout))
            {
                pending.Add(group.Key.Id);
                continue;
            }

            var enabled = aliases.Where(row => row.IsEnabled).Select(row => row.Id).ToHashSet();
            var selected = group.OrderBy(target => target.Device.Id).FirstOrDefault(target => enabled.Contains(target.Device.Id));
            if (selected is null)
            {
                // A newly registered replacement was not in the caller's snapshot: reload on
                // the next pass. A fully unregistered target has nothing left to receive.
                if (enabled.Count > 0) pending.Add(group.Key.Id);
                continue;
            }
            candidates.Add(new(selected, keys));
        }
        await dbContext.SaveChangesAsync(cancellationToken);
        dbContext.ChangeTracker.Clear();
        var requested = candidates.SelectMany(claim => claim.Aliases).ToHashSet();
        var claimed = await TryClaimManyAsync(requested, nowUtc, cancellationToken);
        if (!requested.SetEquals(claimed))
        {
            // An older processor may not participate in token locking. Never send a partly
            // claimed group: undo this transaction and leave the entire batch for recovery.
            await transaction.RollbackAsync(cancellationToken);
            dbContext.ChangeTracker.Clear();
            return new([], notificationIds.ToHashSet());
        }
        await transaction.CommitAsync(cancellationToken);
        return new(candidates, pending);
    }
}
