using System.Collections.Concurrent;
using Juple.Application.Push;
using Juple.Domain.Notifications;
using Juple.Domain.Push;

namespace Juple.Application.Notifications;

/// <summary>
/// Tuning of the notification pipeline. Every value is configuration (NotificationPipeline:*), so each
/// environment can trade latency against cost without a code change.
/// </summary>
public sealed class NotificationPipelineOptions
{
    public const string SectionName = "NotificationPipeline";

    /// <summary>
    /// Fully qualified Service Bus namespace (e.g. sb-juple-dev.servicebus.windows.net) - an address,
    /// not a secret; access is the Managed Identity's role. Empty = no fast path: the API only writes
    /// the outbox and the recovery Job does all the work, exactly like before Service Bus existed.
    /// </summary>
    public string? ServiceBusNamespace { get; set; }

    public string EventsQueueName { get; set; } = "notification-events";

    public string DeliveriesQueueName { get; set; } = "push-deliveries";

    /// <summary>Recipients materialized per page (one keyset query + one batched insert + one cursor update, in one transaction).</summary>
    public int RecipientPageSize { get; set; } = 500;

    /// <summary>Notifications per Push delivery batch (one queue message; one set of context/device queries).</summary>
    public int DeliveryBatchSize { get; set; } = 100;

    /// <summary>Push provider calls in flight at once within one delivery batch.</summary>
    public int MaxConcurrentSends { get; set; } = 8;

    /// <summary>Queue messages each worker replica handles at once, per queue.</summary>
    public int EventsMaxConcurrentCalls { get; set; } = 4;

    public int DeliveriesMaxConcurrentCalls { get; set; } = 4;

    /// <summary>How long a processor owns an outbox event before another may take it over (renewed per page).</summary>
    public int EventLeaseSeconds { get; set; } = 120;

    /// <summary>
    /// Retry back-off of a failed outbox event: the first retry after RetryBaseDelaySeconds, doubling
    /// each attempt, capped at RetryMaxDelaySeconds - so a long outage costs one attempt every few
    /// minutes, never a hot loop, and the event is retried for as long as it takes.
    /// </summary>
    public int RetryBaseDelaySeconds { get; set; } = 5;

    public int RetryMaxDelaySeconds { get; set; } = 300;

    /// <summary>After this many attempts an event is flagged RequiresAttention (for operations) - and still retried.</summary>
    public int AttentionAfterAttempts { get; set; } = 8;

    /// <summary>The recovery Job leaves work younger than this to the fast path, so the two do not normally race.</summary>
    public int RecoveryGraceSeconds { get; set; } = 30;

    /// <summary>Outbox events / pending notifications the recovery Job handles per run.</summary>
    public int RecoveryEventLimit { get; set; } = 100;

    public int RecoveryNotificationLimit { get; set; } = 500;

    /// <summary>Processed outbox events are kept this long (diagnosis), then deleted in bounded batches.</summary>
    public int ProcessedEventRetentionDays { get; set; } = 7;

    /// <summary>
    /// The API's in-process signal channel (committed event ids waiting for the background publisher).
    /// Bounded: when full, a signal is dropped (the event stays in SQL for the recovery Job) - memory
    /// never grows with an outage.
    /// </summary>
    public int SignalChannelCapacity { get; set; } = 10_000;

    /// <summary>Event ids per Service Bus send of the background publisher (whatever is waiting, never waiting to fill a batch).</summary>
    public int SignalBatchSize { get; set; } = 100;

    /// <summary>Upper bound on one background Service Bus send (and its single retry) - off the request path.</summary>
    public int SignalSendTimeoutMilliseconds { get; set; } = 5_000;

    /// <summary>On shutdown, how long the background publisher may still send what is queued; the rest is left to recovery.</summary>
    public int SignalDrainSeconds { get; set; } = 5;

    /// <summary>
    /// The queues' LockDuration in the IaC (infra/azure/foundation - 1 minute). Only documents the value
    /// MaxAutoLockRenewalSeconds must exceed; Service Bus itself owns the real setting.
    /// </summary>
    public int QueueLockDurationSeconds { get; set; } = 60;

    /// <summary>
    /// How long the worker keeps renewing a message's lock while its handler runs. Must exceed the
    /// longest expected handler - an event's whole fan-out (pages of RecipientPageSize, each handed off
    /// in DeliveryBatchSize batches) or one delivery batch sent inline when the deliveries queue is
    /// unreachable - and the queue's LockDuration, so a slow handler does not lose its lock and get its
    /// message redelivered while it is still working. Finite on purpose: a stuck handler eventually
    /// releases it.
    /// </summary>
    public int MaxAutoLockRenewalSeconds { get; set; } = 600;
}

/// <summary>When a failed outbox event is tried again.</summary>
public static class NotificationRetryPolicy
{
    /// <summary>Exponential from the base, capped: attempt 1 → base, 2 → 2×base, … never above the cap.</summary>
    public static TimeSpan DelayAfter(int attempt, NotificationPipelineOptions options)
    {
        var baseSeconds = Math.Max(1, options.RetryBaseDelaySeconds);
        var maxSeconds = Math.Max(baseSeconds, options.RetryMaxDelaySeconds);
        var exponent = Math.Clamp(attempt - 1, 0, 20);
        return TimeSpan.FromSeconds(Math.Min(maxSeconds, baseSeconds * Math.Pow(2, exponent)));
    }
}

/// <summary>The transaction a change and its outbox events share (see ISocialNotificationPublisher.BeginAtomicScopeAsync).</summary>
public interface INotificationOutboxScope : IAsyncDisposable
{
    Task CommitAsync(CancellationToken cancellationToken = default);
}

public static class NotificationOutbox
{
    /// <summary>The outbox scope of a service whose publisher is optional: no publisher, no transaction to share.</summary>
    public static Task<INotificationOutboxScope> BeginAsync(ISocialNotificationPublisher? publisher, CancellationToken cancellationToken = default) =>
        publisher?.BeginAtomicScopeAsync(cancellationToken) ?? Task.FromResult<INotificationOutboxScope>(NoOpScope.Instance);

    public sealed class NoOpScope : INotificationOutboxScope
    {
        public static readonly NoOpScope Instance = new();

        public Task CommitAsync(CancellationToken cancellationToken = default) => Task.CompletedTask;

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}

/// <summary>
/// The fast path's wake-up call: "these outbox events exist". Only ids travel - never content. Called
/// after the commit; it must return at once and never throw (the API's implementation only hands the
/// ids to a bounded in-process channel - the Service Bus send happens in the background). Azure SQL
/// is the record: a lost signal only means the recovery Job processes the event instead.
/// </summary>
public interface INotificationSignal
{
    Task SignalEventsAsync(IReadOnlyCollection<long> eventIds, CancellationToken cancellationToken = default);
}

/// <summary>Hands a batch of materialized notifications to Push delivery (possibly another replica). False when it could not be queued - then the caller delivers it itself.</summary>
public interface IPushDeliveryQueue
{
    Task<bool> TryEnqueueAsync(IReadOnlyList<long> notificationIds, CancellationToken cancellationToken = default);
}

/// <summary>One page of an outbox event's recipients, materialized.</summary>
/// <param name="NotificationIds">The Notification rows this page created (an already existing one - a redelivered page - is not repeated).</param>
/// <param name="Completed">Every recipient is done (the event is marked processed).</param>
/// <param name="ChildEventIds">Per-Collection events an item-wide event expanded into, to be processed next.</param>
/// <param name="PermanentFailureCode">Set when the event can never be processed (malformed) - it was closed as FailedPermanent.</param>
public sealed record MaterializedPage(IReadOnlyList<long> NotificationIds, bool Completed, IReadOnlyList<long> ChildEventIds, string? PermanentFailureCode = null);

public sealed record NotificationOutboxStats(
    int PendingEvents,
    double? OldestPendingEventSeconds,
    int PendingNotifications,
    double? OldestPendingNotificationSeconds,
    int EventsRequiringAttention = 0,
    int EventsFailedPermanently = 0);

public interface INotificationEventStore
{
    /// <summary>
    /// Takes the event for processing in one conditional UPDATE: only if it is Pending, due (its next
    /// attempt is not in the future) and nobody holds a live lease. Returns the attempt number, or null
    /// when there is nothing to do here (gone, completed, not yet due, or owned by another processor).
    /// </summary>
    Task<int?> TryClaimAsync(long eventId, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default);

    /// <summary>
    /// Materializes the next page of the claimed event's recipients - their Notification rows and the
    /// new cursor in one transaction, so a crash between pages loses or repeats nothing - and renews
    /// the lease. Applies who-is-told rules (self, opt-outs, membership) at this moment.
    /// </summary>
    Task<MaterializedPage> MaterializeNextPageAsync(long eventId, int pageSize, DateTimeOffset nowUtc, TimeSpan lease, CancellationToken cancellationToken = default);

    /// <summary>
    /// After a failed attempt: gives the lease back, keeps the event Pending and schedules its next
    /// attempt (recording a short error code - never content). Never a terminal state.
    /// </summary>
    Task ScheduleRetryAsync(long eventId, string errorCode, DateTimeOffset nextAttemptAtUtc, bool requiresAttention, CancellationToken cancellationToken = default);

    /// <summary>Pending events created before createdBefore that are due and nobody holds a live lease on, oldest first.</summary>
    Task<IReadOnlyList<long>> ListRecoverableAsync(int limit, DateTimeOffset createdBefore, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Completed (Processed or FailedPermanent) events older than the cutoff, in a bounded batch.</summary>
    Task<int> DeleteCompletedBeforeAsync(DateTimeOffset cutoff, int limit, CancellationToken cancellationToken = default);

    Task<NotificationOutboxStats> GetStatsAsync(DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

/// <param name="RetryLater">Notifications kept pending after a transient provider failure.</param>
/// <param name="OldestAgeMs">Age of the oldest notification in the work when it started - the queueing delay.</param>
public sealed record PushDeliveryResult(int Pending, int Sent, int Failed, int Skipped, int Expired, int InvalidTokens, int RetryLater = 0, long OldestAgeMs = 0)
{
    public static readonly PushDeliveryResult Empty = new(0, 0, 0, 0, 0, 0);

    public PushDeliveryResult Add(PushDeliveryResult other) => new(
        Pending + other.Pending, Sent + other.Sent, Failed + other.Failed, Skipped + other.Skipped, Expired + other.Expired,
        InvalidTokens + other.InvalidTokens, RetryLater + other.RetryLater, Math.Max(OldestAgeMs, other.OldestAgeMs));
}

/// <summary>
/// Sends a batch of materialized notifications - the one delivery implementation, used by the queue
/// worker and the recovery Job alike. Per batch: one load, one set of context queries, one device
/// query, one batched claim, bounded-parallel sends, one batched record. A (notification, device)
/// pair is sent only by whoever claimed it (INotificationDeliveryStore), so the worker, a redelivered
/// message and the recovery Job never normally send the same Push twice.
///
/// At-least-once, not exactly-once: if the process dies after the provider accepted a Push but before
/// its Sent row is written, the claim's lease expires and the Push is sent again. No provider offers a
/// transaction to close that window; it is narrow and bounded by the lease.
/// </summary>
public interface IPushDeliveryProcessor
{
    Task<PushDeliveryResult> DeliverAsync(IReadOnlyCollection<long> notificationIds, CancellationToken cancellationToken = default);

    Task<PushDeliveryResult> DeliverLoadedAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellationToken = default);
}

public sealed class PushDeliveryProcessor(
    IPushDispatchStore dispatchStore,
    INotificationDeliveryStore deliveryStore,
    IPushDeviceRegistrationStore deviceStore,
    IPushSender pushSender,
    TimeProvider timeProvider,
    NotificationPipelineOptions options) : IPushDeliveryProcessor
{
    public async Task<PushDeliveryResult> DeliverAsync(IReadOnlyCollection<long> notificationIds, CancellationToken cancellationToken = default)
    {
        if (notificationIds.Count == 0)
        {
            return PushDeliveryResult.Empty;
        }

        var notifications = await dispatchStore.ListUndispatchedAsync(notificationIds, cancellationToken);
        return await DeliverLoadedAsync(notifications, cancellationToken);
    }

    public async Task<PushDeliveryResult> DeliverLoadedAsync(IReadOnlyList<Notification> notifications, CancellationToken cancellationToken = default)
    {
        var total = PushDeliveryResult.Empty;
        foreach (var batch in notifications.Chunk(Math.Max(1, options.DeliveryBatchSize)))
        {
            total = total.Add(await DeliverBatchAsync(batch, cancellationToken));
        }

        return total;
    }

    private async Task<PushDeliveryResult> DeliverBatchAsync(IReadOnlyList<Notification> batch, CancellationToken cancellationToken)
    {
        var startedAtUtc = timeProvider.GetUtcNow();
        var done = new List<long>();
        var expired = 0;
        var live = new List<Notification>();
        foreach (var notification in batch)
        {
            if (startedAtUtc - notification.CreatedAtUtc > SocialNotificationPolicy.MaxAge(notification.Type))
            {
                done.Add(notification.Id);
                expired++;
            }
            else
            {
                live.Add(notification);
            }
        }

        var contexts = live.Count == 0
            ? new Dictionary<long, PushDispatchContext>()
            : await dispatchStore.GetContextsAsync(live, startedAtUtc, cancellationToken);
        var relevant = live.Where(notification => contexts.TryGetValue(notification.Id, out var context) && context.IsRelevant).ToList();
        var relevantIds = relevant.Select(notification => notification.Id).ToHashSet();
        var devicesByUser = relevant.Count == 0
            ? new Dictionary<long, List<PushDeviceRegistration>>()
            : (await deviceStore.ListEnabledForUsersAsync(relevant.Select(notification => notification.UserId).Distinct().ToList(), cancellationToken))
                .GroupBy(device => device.UserId)
                .ToDictionary(group => group.Key, group => group.ToList());

        var skipped = 0;
        var pairs = new List<(Notification Notification, PushDeviceRegistration Device)>();
        foreach (var notification in live)
        {
            if (!relevantIds.Contains(notification.Id) || !devicesByUser.TryGetValue(notification.UserId, out var devices))
            {
                // No longer relevant (answered, removed, left, turned off) or nobody to send to.
                done.Add(notification.Id);
                skipped++;
                continue;
            }

            pairs.AddRange(devices.Select(device => (notification, device)));
        }

        var claimed = pairs.Count == 0
            ? new HashSet<DeliveryKey>()
            : await deliveryStore.TryClaimManyAsync(
                pairs.Select(pair => new DeliveryKey(pair.Notification.Id, pair.Device.Id)).ToList(), timeProvider.GetUtcNow(), cancellationToken);
        var toSend = pairs.Where(pair => claimed.Contains(new DeliveryKey(pair.Notification.Id, pair.Device.Id))).ToList();

        var attempts = new ConcurrentBag<DeliveryAttempt>();
        await Parallel.ForEachAsync(
            toSend,
            new ParallelOptions { MaxDegreeOfParallelism = Math.Max(1, options.MaxConcurrentSends), CancellationToken = cancellationToken },
            async (pair, token) =>
            {
                var payload = DispatchPendingPushNotificationsService.BuildPayload(pair.Notification, contexts[pair.Notification.Id], pair.Device.Locale);
                var result = await pushSender.SendAsync(pair.Device, payload, token);
                attempts.Add(new DeliveryAttempt(
                    new DeliveryKey(pair.Notification.Id, pair.Device.Id), result.Status, timeProvider.GetUtcNow(), result.ProviderMessageId, result.FailureCode));
            });

        if (!attempts.IsEmpty)
        {
            await deliveryStore.RecordAttemptsAsync(attempts.ToList(), cancellationToken);
        }

        var failedAttempts = attempts.Where(attempt => attempt.Status != NotificationDeliveryStatus.Sent).ToList();
        var deadTokens = failedAttempts.Where(attempt => PushSendFailureCodes.IsPermanent(attempt.FailureCode)).ToList();
        foreach (var deviceId in deadTokens.Select(attempt => attempt.Key.PushDeviceRegistrationId).Distinct())
        {
            // A permanently invalid token is disabled, never retried.
            await deviceStore.DisableByIdAsync(deviceId, timeProvider.GetUtcNow(), cancellationToken);
        }

        // A transient failure keeps its notification pending for a later attempt (until it expires);
        // every other notification of the batch is done - including one whose device another live
        // claim holds (that claimer records the outcome).
        var retryLater = failedAttempts.Where(attempt => !PushSendFailureCodes.IsPermanent(attempt.FailureCode))
            .Select(attempt => attempt.Key.NotificationId)
            .ToHashSet();
        done.AddRange(pairs.Select(pair => pair.Notification.Id).Distinct().Where(id => !retryLater.Contains(id)));
        if (done.Count > 0)
        {
            await dispatchStore.MarkDispatchedAsync(done.Distinct().ToList(), timeProvider.GetUtcNow(), cancellationToken);
        }

        return new PushDeliveryResult(
            batch.Count,
            attempts.Count(attempt => attempt.Status == NotificationDeliveryStatus.Sent),
            failedAttempts.Count,
            skipped,
            expired,
            deadTokens.Count,
            retryLater.Count,
            (long)(startedAtUtc - batch.Min(notification => notification.CreatedAtUtc)).TotalMilliseconds);
    }
}

/// <param name="Processed">This call claimed and finished the event (false: done already, gone, or another processor holds it).</param>
/// <param name="Delivered">What this call sent itself (inline, or because the deliveries queue was unreachable) - nothing when it handed everything to the queue.</param>
/// <param name="PermanentFailureCode">The event was closed as FailedPermanent (malformed) - with this code.</param>
public sealed record NotificationEventOutcome(
    bool Processed, int Materialized, int Pages = 0, int Children = 0, PushDeliveryResult? Delivered = null, string? PermanentFailureCode = null);

/// <summary>
/// A processing attempt failed; the event stays Pending in SQL with its next attempt scheduled. The
/// caller (worker or recovery Job) only logs it - SQL owns the retry, whatever happens to the message.
/// </summary>
public sealed class NotificationEventRetryScheduledException(long eventId, int attempt, DateTimeOffset nextAttemptAtUtc, bool requiresAttention, Exception inner)
    : Exception($"Notification event {eventId} attempt {attempt} failed ({inner.GetType().Name}); retry scheduled.", inner)
{
    public long EventId { get; } = eventId;

    public int Attempt { get; } = attempt;

    public DateTimeOffset NextAttemptAtUtc { get; } = nextAttemptAtUtc;

    public bool RequiresAttention { get; } = requiresAttention;
}

/// <summary>
/// Turns one outbox event into its recipients' Notification rows, page by page (bounded memory, a
/// fixed number of queries per page), and hands each page to Push delivery - through the deliveries
/// queue when there is one (so other replicas share a large fan-out), else directly. The same code
/// runs for a Service Bus message and for the recovery Job; the event's lease decides who works on
/// it, so a duplicate message or a racing Job does nothing.
/// </summary>
public interface INotificationEventProcessor
{
    Task<NotificationEventOutcome> ProcessAsync(long eventId, bool deliverInline, CancellationToken cancellationToken = default);
}

public sealed class NotificationEventProcessor(
    INotificationEventStore eventStore,
    IPushDeliveryProcessor deliveryProcessor,
    TimeProvider timeProvider,
    NotificationPipelineOptions options,
    IPushDeliveryQueue? deliveryQueue = null) : INotificationEventProcessor
{
    public async Task<NotificationEventOutcome> ProcessAsync(long eventId, bool deliverInline, CancellationToken cancellationToken = default)
    {
        var lease = TimeSpan.FromSeconds(Math.Max(10, options.EventLeaseSeconds));
        if (await eventStore.TryClaimAsync(eventId, timeProvider.GetUtcNow(), lease, cancellationToken) is not { } attempt)
        {
            return new NotificationEventOutcome(false, 0);
        }

        string? permanentFailureCode = null;
        var materialized = 0;
        var pages = 0;
        var children = new List<long>();
        var delivered = PushDeliveryResult.Empty;
        try
        {
            while (true)
            {
                var page = await eventStore.MaterializeNextPageAsync(
                    eventId, Math.Max(1, options.RecipientPageSize), timeProvider.GetUtcNow(), lease, cancellationToken);
                pages++;
                materialized += page.NotificationIds.Count;
                children.AddRange(page.ChildEventIds);
                permanentFailureCode ??= page.PermanentFailureCode;
                if (page.NotificationIds.Count > 0)
                {
                    delivered = delivered.Add(await HandOffAsync(page.NotificationIds, deliverInline, cancellationToken));
                }

                if (page.Completed)
                {
                    break;
                }
            }
        }
        catch (Exception exception)
        {
            // Every exception here is treated as transient (SQL timeout, network, a restart): the event
            // stays Pending with a capped back-off - never given up. Only a structurally impossible
            // event is permanent, and the store decides that without throwing.
            var nextAttemptAtUtc = timeProvider.GetUtcNow() + NotificationRetryPolicy.DelayAfter(attempt, options);
            var requiresAttention = attempt >= Math.Max(1, options.AttentionAfterAttempts);
            await eventStore.ScheduleRetryAsync(eventId, exception.GetType().Name, nextAttemptAtUtc, requiresAttention, CancellationToken.None);
            throw new NotificationEventRetryScheduledException(eventId, attempt, nextAttemptAtUtc, requiresAttention, exception);
        }

        foreach (var childId in children)
        {
            var child = await ProcessAsync(childId, deliverInline, cancellationToken);
            materialized += child.Materialized;
            delivered = delivered.Add(child.Delivered ?? PushDeliveryResult.Empty);
        }

        return new NotificationEventOutcome(true, materialized, pages, children.Count, delivered, permanentFailureCode);
    }

    private async Task<PushDeliveryResult> HandOffAsync(IReadOnlyList<long> notificationIds, bool deliverInline, CancellationToken cancellationToken)
    {
        var delivered = PushDeliveryResult.Empty;
        foreach (var chunk in notificationIds.Chunk(Math.Max(1, options.DeliveryBatchSize)))
        {
            if (!deliverInline && deliveryQueue is not null && await deliveryQueue.TryEnqueueAsync(chunk, cancellationToken))
            {
                continue;
            }

            // No queue (or it is unreachable right now): this processor sends the batch itself.
            delivered = delivered.Add(await deliveryProcessor.DeliverAsync(chunk, cancellationToken));
        }

        return delivered;
    }
}
