using Juple.Application.Notifications;
using Juple.Application.Push;
using Juple.Infrastructure.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Push;

namespace Juple.IntegrationTests.TestSupport;

/// <summary>
/// The notification pipeline wired against the real schema, the way the push-dispatch Job and the
/// worker wire it - for tests that drive notifications end to end. Events are recorded by the API
/// path (SocialNotificationPublisher) and become Notification rows only when processed, so a test
/// that inspects rows first materializes the outbox (MaterializeOutboxAsync), and the recovery Job
/// (Dispatcher) runs with no grace period - everything already recorded is due.
/// </summary>
internal static class NotificationPipelineTestKit
{
    public static NotificationPipelineOptions Options(int recipientPageSize = 500, int deliveryBatchSize = 100) => new()
    {
        RecoveryGraceSeconds = 0,
        RecipientPageSize = recipientPageSize,
        DeliveryBatchSize = deliveryBatchSize,
        MaxConcurrentSends = 1,
        RecoveryEventLimit = 1000,
        RecoveryNotificationLimit = 5000,
    };

    public static PushDeliveryProcessor Delivery(JupleDbContext db, IPushSender sender, TimeProvider? time = null, NotificationPipelineOptions? options = null) =>
        new(new PushDispatchStore(db), new NotificationDeliveryStore(db), new PushDeviceRegistrationStore(db), sender, time ?? TimeProvider.System, options ?? Options());

    public static NotificationEventProcessor Processor(
        JupleDbContext db, IPushSender sender, IPushDeliveryQueue? queue = null, TimeProvider? time = null, NotificationPipelineOptions? options = null) =>
        new(new NotificationEventStore(db), Delivery(db, sender, time, options), time ?? TimeProvider.System, options ?? Options(), queue);

    /// <summary>The push-dispatch Job (recovery sweep) with no grace period.</summary>
    public static DispatchPendingPushNotificationsService Dispatcher(
        JupleDbContext db, IPushSender sender, TimeProvider? time = null, NotificationPipelineOptions? options = null) =>
        new(
            new NotificationEventStore(db),
            Processor(db, sender, null, time, options),
            new PushDispatchStore(db),
            Delivery(db, sender, time, options),
            time ?? TimeProvider.System,
            options ?? Options());

    /// <summary>
    /// Turns every recorded, unprocessed outbox event into its Notification rows - nothing is sent
    /// (that is the Dispatcher's or the worker's part). Returns how many rows were created.
    /// </summary>
    public static async Task<int> MaterializeOutboxAsync(JupleDbContext db, int pageSize = 500)
    {
        var store = new NotificationEventStore(db);
        var nowUtc = DateTimeOffset.UtcNow;
        var created = 0;
        var pending = new Queue<long>(await store.ListRecoverableAsync(100_000, nowUtc.AddMinutes(1), nowUtc));
        while (pending.TryDequeue(out var eventId))
        {
            if (await store.TryClaimAsync(eventId, DateTimeOffset.UtcNow, TimeSpan.FromMinutes(2)) is null)
            {
                continue;
            }

            while (true)
            {
                var page = await store.MaterializeNextPageAsync(eventId, pageSize, DateTimeOffset.UtcNow, TimeSpan.FromMinutes(2));
                created += page.NotificationIds.Count;
                foreach (var child in page.ChildEventIds)
                {
                    pending.Enqueue(child);
                }

                if (page.Completed)
                {
                    break;
                }
            }
        }

        db.ChangeTracker.Clear();
        return created;
    }
}
