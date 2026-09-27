using Juple.Application.Notifications;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Notifications;

public sealed class NotificationDeliveryStore(JupleDbContext dbContext) : INotificationDeliveryStore
{
    /// <summary>
    /// How long a Sending row can go without a final Sent/Failed outcome before it is presumed
    /// abandoned (most likely a crash between claiming and recording) and becomes reclaimable - see
    /// NotificationDelivery's own remarks. Chosen to comfortably exceed how long a single real send
    /// call should ever take (FirebaseCloudMessagingSender times out at 20 seconds), so a stuck claim
    /// is retried by a later dispatch pass rather than lingering.
    /// </summary>
    private static readonly TimeSpan StaleSendingLeaseTimeout = TimeSpan.FromMinutes(15);

    public async Task<bool> TryClaimAsync(
        long notificationId, long pushDeviceRegistrationId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        try
        {
            dbContext.NotificationDeliveries.Add(new NotificationDelivery(
                notificationId, pushDeviceRegistrationId, NotificationDeliveryStatus.Sending, attemptCount: 1, nowUtc, null, null));
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A row already exists (a prior Failed/stale-Sending attempt, or another dispatcher just
            // won the insert race below) - mirrors NotificationStore.MaterializeDueAsync's identical
            // race-safety pattern. Fall through to the conditional-update claim path.
            dbContext.ChangeTracker.Clear();
        }

        // A single conditional UPDATE, not a read followed by a write - the affected-row count (0 or
        // 1) IS the atomic claim decision, covering both reclaim cases in one predicate:
        //   - Failed: always claimable (ordinary retry).
        //   - Sending: claimable only if its lease (AttemptedAtUtc) is older than the stale-lease
        //     timeout - a fresh Sending row (another caller's live claim) matches zero rows here.
        // If two callers race on the same stale-Sending row, only one's UPDATE actually flips it (SQL
        // Server serializes the row-level write); the moment it commits, AttemptedAtUtc becomes
        // "now," so a second caller's WHERE clause - evaluated against the now-committed row - no
        // longer matches, even under READ COMMITTED. There is no read-then-write gap for a race to
        // land in.
        var staleBefore = nowUtc - StaleSendingLeaseTimeout;
        var claimedRows = await dbContext.NotificationDeliveries
            .Where(delivery =>
                delivery.NotificationId == notificationId
                && delivery.PushDeviceRegistrationId == pushDeviceRegistrationId
                && (delivery.Status == NotificationDeliveryStatus.Failed
                    || (delivery.Status == NotificationDeliveryStatus.Sending && delivery.AttemptedAtUtc <= staleBefore)))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(delivery => delivery.Status, NotificationDeliveryStatus.Sending)
                    .SetProperty(delivery => delivery.AttemptedAtUtc, nowUtc)
                    .SetProperty(delivery => delivery.AttemptCount, delivery => delivery.AttemptCount + 1),
                cancellationToken);

        return claimedRows == 1;
    }

    public async Task RecordAttemptAsync(
        long notificationId,
        long pushDeviceRegistrationId,
        NotificationDeliveryStatus status,
        DateTimeOffset attemptedAtUtc,
        string? providerMessageId,
        string? failureCode,
        CancellationToken cancellationToken = default)
    {
        var existing = await dbContext.NotificationDeliveries
            .FirstOrDefaultAsync(
                delivery =>
                    delivery.NotificationId == notificationId
                    && delivery.PushDeviceRegistrationId == pushDeviceRegistrationId,
                cancellationToken);

        if (existing is not null)
        {
            existing.RecordAttempt(status, attemptedAtUtc, providerMessageId, failureCode);
        }
        else
        {
            // Defensive only - in the real flow TryClaimAsync always creates/claims this row first,
            // so this branch should never actually run.
            dbContext.NotificationDeliveries.Add(new NotificationDelivery(
                notificationId, pushDeviceRegistrationId, status, attemptCount: 1, attemptedAtUtc, providerMessageId, failureCode));
        }

        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (
            SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent dispatch pass already recorded this exact (Notification, Device) attempt -
            // mirrors NotificationStore.MaterializeDueAsync's identical race-safety pattern.
            dbContext.ChangeTracker.Clear();
        }
    }
}
