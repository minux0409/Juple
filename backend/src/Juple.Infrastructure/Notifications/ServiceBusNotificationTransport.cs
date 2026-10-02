using System.Globalization;
using System.Threading.Channels;
using Azure.Identity;
using Azure.Messaging.ServiceBus;
using Juple.Application.Notifications;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Notifications;

/// <summary>
/// The one ServiceBusClient of the process and its two senders (thread-safe, connection-pooled -
/// singletons by design, never one per message). Authenticates with DefaultAzureCredential - in
/// Azure the user-assigned Managed Identity named by AZURE_CLIENT_ID, which holds only the queue
/// roles its component needs; no connection string or key exists anywhere. Constructing it makes no
/// network call.
/// </summary>
public sealed class ServiceBusNotificationTransport(NotificationPipelineOptions options) : IAsyncDisposable
{
    private readonly ServiceBusClient _client = new(options.ServiceBusNamespace, new DefaultAzureCredential());
    private ServiceBusSender? _events;
    private ServiceBusSender? _deliveries;
    private readonly object _gate = new();

    public ServiceBusClient Client => _client;

    public ServiceBusSender EventsSender
    {
        get
        {
            lock (_gate)
            {
                return _events ??= _client.CreateSender(options.EventsQueueName);
            }
        }
    }

    public ServiceBusSender DeliveriesSender
    {
        get
        {
            lock (_gate)
            {
                return _deliveries ??= _client.CreateSender(options.DeliveriesQueueName);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        // Senders first, then the client (disposing the client also closes them; this is just orderly).
        if (_events is not null)
        {
            await _events.DisposeAsync();
        }

        if (_deliveries is not null)
        {
            await _deliveries.DisposeAsync();
        }

        await _client.DisposeAsync();
    }
}

/// <summary>
/// The API's in-process hand-off between a committed request and the background signal publisher:
/// a bounded channel of outbox event ids. Not durable on purpose - it only accelerates; the SQL outbox
/// is the record, so whatever is in here when the process stops, or does not fit, is recovered by the
/// push-dispatch Job. Memory is bounded by SignalChannelCapacity whatever happens to Service Bus.
/// </summary>
public sealed class NotificationSignalChannel(NotificationPipelineOptions options)
{
    private readonly Channel<long> _channel = Channel.CreateBounded<long>(new BoundedChannelOptions(Math.Max(1, options.SignalChannelCapacity))
    {
        // TryWrite answers false when full instead of waiting - a request never waits on it.
        FullMode = BoundedChannelFullMode.Wait,
        SingleReader = true,
        SingleWriter = false,
    });

    public ChannelReader<long> Reader => _channel.Reader;

    /// <summary>Immediate, never blocks: false when the channel is full or no longer accepting (shutting down).</summary>
    public bool TryWrite(long eventId) => _channel.Writer.TryWrite(eventId);

    /// <summary>Stops accepting new signals (shutdown); what is already queued can still be read.</summary>
    public void Complete() => _channel.Writer.TryComplete();
}

/// <summary>
/// INotificationSignal for the API: hands committed event ids to the in-process channel and returns at
/// once - no network call, no wait, never an exception on the request's path. A full channel drops the
/// signal (logged); the event is still in SQL and the recovery Job processes it.
/// </summary>
public sealed class ChannelNotificationSignal(NotificationSignalChannel channel, ILogger<ChannelNotificationSignal> logger) : INotificationSignal
{
    public Task SignalEventsAsync(IReadOnlyCollection<long> eventIds, CancellationToken cancellationToken = default)
    {
        var dropped = 0;
        foreach (var eventId in eventIds)
        {
            if (!channel.TryWrite(eventId))
            {
                dropped++;
            }
        }

        if (dropped > 0)
        {
            logger.LogWarning(
                "Notification signal channel full or closed: {DroppedCount} of {EventCount} signals dropped; the recovery Job will process those events.",
                dropped, eventIds.Count);
        }
        else
        {
            logger.LogDebug("Notification signal channel accepted {EventCount} signals.", eventIds.Count);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// Sends one batch of event-id signals to the notification-events queue for the API's background
/// publisher: one message per event (ids only), bounded by SignalSendTimeoutMilliseconds with a single
/// short retry. Never throws - a failure is logged and the events are left to the recovery Job.
/// </summary>
public sealed class ServiceBusSignalSender(
    ServiceBusNotificationTransport transport,
    NotificationPipelineOptions options,
    ILogger<ServiceBusSignalSender> logger) : INotificationSignalSender
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(500);

    public async Task<bool> SendAsync(IReadOnlyList<long> eventIds, CancellationToken cancellationToken)
    {
        if (eventIds.Count == 0)
        {
            return true;
        }

        for (var attempt = 1; attempt <= 2; attempt++)
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromMilliseconds(Math.Max(100, options.SignalSendTimeoutMilliseconds)));
            try
            {
                await transport.EventsSender.SendMessagesAsync(eventIds.Select(CreateSignal), timeout.Token);
                logger.LogInformation("Notification signals sent. Count={EventCount} Attempt={Attempt}", eventIds.Count, attempt);
                return true;
            }
            catch (Exception exception) when (!cancellationToken.IsCancellationRequested)
            {
                logger.LogWarning(
                    "Could not send {EventCount} notification signals ({ErrorType}), attempt {Attempt} of 2; the recovery Job covers them.",
                    eventIds.Count, exception.GetType().Name, attempt);
                if (attempt == 1)
                {
                    try
                    {
                        await Task.Delay(RetryDelay, cancellationToken);
                    }
                    catch (OperationCanceledException)
                    {
                        return false;
                    }
                }
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        return false;
    }

    /// <summary>The whole signal: the event id as text, nothing about the event itself.</summary>
    public static ServiceBusMessage CreateSignal(long eventId) => new(eventId.ToString(CultureInfo.InvariantCulture))
    {
        MessageId = $"ev-{eventId}",
        ContentType = "text/plain",
    };
}

/// <summary>
/// Puts one delivery batch on the deliveries queue: its notification ids, comma-separated (at most
/// DeliveryBatchSize - a few hundred bytes). False when the queue cannot be reached right now.
/// </summary>
public sealed class ServiceBusPushDeliveryQueue(
    ServiceBusNotificationTransport transport,
    ILogger<ServiceBusPushDeliveryQueue> logger) : IPushDeliveryQueue
{
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(5);

    public async Task<bool> TryEnqueueAsync(IReadOnlyList<long> notificationIds, CancellationToken cancellationToken = default)
    {
        if (notificationIds.Count == 0)
        {
            return true;
        }

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(SendTimeout);
        try
        {
            await transport.DeliveriesSender.SendMessageAsync(
                new ServiceBusMessage(string.Join(',', notificationIds.Select(id => id.ToString(CultureInfo.InvariantCulture))))
                {
                    MessageId = $"nd-{notificationIds[0]}-{notificationIds[^1]}-{notificationIds.Count}",
                    ContentType = "text/plain",
                },
                timeout.Token);
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(
                "Could not queue a delivery batch of {NotificationCount} ({ErrorType}); delivering it directly.",
                notificationIds.Count, exception.GetType().Name);
            return false;
        }
    }
}

/// <summary>No Service Bus configured: nothing to wake - the recovery Job processes every event.</summary>
public sealed class NoOpNotificationSignal : INotificationSignal
{
    public Task SignalEventsAsync(IReadOnlyCollection<long> eventIds, CancellationToken cancellationToken = default) => Task.CompletedTask;
}

/// <summary>No Service Bus configured: every delivery batch is sent by whoever materialized it.</summary>
public sealed class NoPushDeliveryQueue : IPushDeliveryQueue
{
    public Task<bool> TryEnqueueAsync(IReadOnlyList<long> notificationIds, CancellationToken cancellationToken = default) => Task.FromResult(false);
}

/// <summary>
/// The notification worker's message loop: the events queue (materialize recipients) and the
/// deliveries queue (send Push), each with its own bounded concurrency. Settling rules:
///  - processed, nothing left to do (a duplicate message, an event not due or held elsewhere), or the
///    attempt failed with its retry scheduled in SQL: completed - SQL owns the retry from there;
///  - a malformed message: dead-lettered at once (it can never succeed);
///  - any other failure (e.g. SQL unreachable even to schedule the retry): left unsettled, so its lock
///    expires and Service Bus redelivers it after the lock duration; after the queue's MaxDeliveryCount
///    it is dead-lettered. A dead-lettered SIGNAL never invalidates its event: the event is still
///    Pending in SQL and the recovery Job processes it.
/// Logs carry ids, counts and timings only.
/// </summary>
public sealed class ServiceBusNotificationConsumer(
    ServiceBusNotificationTransport transport,
    IServiceScopeFactory scopeFactory,
    NotificationPipelineOptions options,
    TimeProvider timeProvider,
    ILogger<ServiceBusNotificationConsumer> logger)
{
    private const int MaxIdsPerDeliveryMessage = 1000;

    public async Task RunAsync(CancellationToken stoppingToken)
    {
        await using var events = transport.Client.CreateProcessor(options.EventsQueueName, CreateProcessorOptions(options, options.EventsMaxConcurrentCalls, "events"));
        await using var deliveries = transport.Client.CreateProcessor(options.DeliveriesQueueName, CreateProcessorOptions(options, options.DeliveriesMaxConcurrentCalls, "deliveries"));
        events.ProcessMessageAsync += HandleEventAsync;
        events.ProcessErrorAsync += HandleErrorAsync;
        deliveries.ProcessMessageAsync += HandleDeliveryAsync;
        deliveries.ProcessErrorAsync += HandleErrorAsync;

        await events.StartProcessingAsync(stoppingToken);
        await deliveries.StartProcessingAsync(stoppingToken);
        logger.LogInformation(
            "Notification worker started. EventsConcurrency={EventsConcurrency} DeliveriesConcurrency={DeliveriesConcurrency} MaxAutoLockRenewalSeconds={MaxAutoLockRenewalSeconds}",
            options.EventsMaxConcurrentCalls, options.DeliveriesMaxConcurrentCalls, options.MaxAutoLockRenewalSeconds);
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Shutting down: stop taking messages; in-flight handlers finish or their locks expire.
        }

        await events.StopProcessingAsync(CancellationToken.None);
        await deliveries.StopProcessingAsync(CancellationToken.None);
        logger.LogInformation("Notification worker stopped.");
    }

    /// <summary>
    /// Explicit, never the SDK's defaults: manual settling, bounded concurrency, no prefetch (a
    /// prefetched message's lock runs while it waits, and a scaled-in replica would strand it), and lock
    /// auto-renewal long enough for the slowest handler - well beyond the queue's LockDuration, but
    /// finite. No sessions (ordering is not needed).
    /// </summary>
    public static ServiceBusProcessorOptions CreateProcessorOptions(NotificationPipelineOptions options, int maxConcurrentCalls, string role) => new()
    {
        AutoCompleteMessages = false,
        ReceiveMode = ServiceBusReceiveMode.PeekLock,
        MaxConcurrentCalls = Math.Max(1, maxConcurrentCalls),
        PrefetchCount = 0,
        MaxAutoLockRenewalDuration = TimeSpan.FromSeconds(Math.Max(options.QueueLockDurationSeconds * 2, options.MaxAutoLockRenewalSeconds)),
        Identifier = $"juple-notification-worker-{role}",
    };

    private async Task HandleEventAsync(ProcessMessageEventArgs args)
    {
        if (!long.TryParse(args.Message.Body.ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var eventId) || eventId <= 0)
        {
            await args.DeadLetterMessageAsync(args.Message, "MalformedBody", "Not an outbox event id.", args.CancellationToken);
            return;
        }

        var queueLatencyMs = (long)(timeProvider.GetUtcNow() - args.Message.EnqueuedTime).TotalMilliseconds;
        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var outcome = await scope.ServiceProvider.GetRequiredService<INotificationEventProcessor>()
                .ProcessAsync(eventId, deliverInline: false, args.CancellationToken);
            await args.CompleteMessageAsync(args.Message, args.CancellationToken);
            if (outcome.PermanentFailureCode is { } code)
            {
                logger.LogError("Notification event {EventId} failed permanently ({ErrorCode}); it will not be retried.", eventId, code);
            }
            else if (!outcome.Processed)
            {
                logger.LogInformation(
                    "Notification event {EventId} not claimed (completed, not yet due, or leased by another processor). QueueLatencyMs={QueueLatencyMs}",
                    eventId, queueLatencyMs);
            }
            else
            {
                logger.LogInformation(
                    "Notification event handled. EventId={EventId} Materialized={Materialized} Pages={Pages} Children={Children} QueueLatencyMs={QueueLatencyMs} DeliveryCount={DeliveryCount}",
                    eventId, outcome.Materialized, outcome.Pages, outcome.Children, queueLatencyMs, args.Message.DeliveryCount);
            }
        }
        catch (NotificationEventRetryScheduledException retry)
        {
            // SQL owns the retry (back-off); the message's job - waking a processor - is done.
            await args.CompleteMessageAsync(args.Message, CancellationToken.None);
            LogRetryScheduled(logger, retry);
        }
        catch (Exception exception) when (!args.CancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(
                "Notification event {EventId} failed ({ErrorType}), delivery {DeliveryCount}; the message will be redelivered after its lock expires, and the event stays Pending in SQL.",
                eventId, exception.GetType().Name, args.Message.DeliveryCount);
        }
    }

    private async Task HandleDeliveryAsync(ProcessMessageEventArgs args)
    {
        var ids = ParseIds(args.Message.Body.ToString());
        if (ids is null)
        {
            await args.DeadLetterMessageAsync(args.Message, "MalformedBody", "Not a list of notification ids.", args.CancellationToken);
            return;
        }

        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            var result = await scope.ServiceProvider.GetRequiredService<IPushDeliveryProcessor>().DeliverAsync(ids, args.CancellationToken);
            await args.CompleteMessageAsync(args.Message, args.CancellationToken);
            logger.LogInformation(
                "Push delivery handled. Notifications={Notifications} Sent={Sent} Failed={Failed} Skipped={Skipped} Expired={Expired} InvalidTokens={InvalidTokens} RetryLater={RetryLater} OldestAgeMs={OldestAgeMs} QueueLatencyMs={QueueLatencyMs} DeliveryCount={DeliveryCount}",
                result.Pending, result.Sent, result.Failed, result.Skipped, result.Expired, result.InvalidTokens, result.RetryLater, result.OldestAgeMs,
                (long)(timeProvider.GetUtcNow() - args.Message.EnqueuedTime).TotalMilliseconds, args.Message.DeliveryCount);
        }
        catch (Exception exception) when (!args.CancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(
                "Push delivery batch of {NotificationCount} failed ({ErrorType}), delivery {DeliveryCount}; it will be redelivered after the lock expires, and the notifications stay pending in SQL.",
                ids.Count, exception.GetType().Name, args.Message.DeliveryCount);
        }
    }

    private Task HandleErrorAsync(ProcessErrorEventArgs args)
    {
        logger.LogWarning(
            "Service Bus processing error. Source={ErrorSource} Entity={EntityPath} ErrorType={ErrorType}",
            args.ErrorSource, args.EntityPath, args.Exception.GetType().Name);
        return Task.CompletedTask;
    }

    /// <summary>The structured line operations search for: a failed attempt, its back-off, and whether it now needs attention.</summary>
    public static void LogRetryScheduled(ILogger logger, NotificationEventRetryScheduledException retry)
    {
        if (retry.RequiresAttention)
        {
            logger.LogError(
                "Notification event {EventId} requires attention: attempt {Attempt} failed ({ErrorType}); still retrying, next at {NextAttemptAtUtc:O}.",
                retry.EventId, retry.Attempt, retry.InnerException?.GetType().Name, retry.NextAttemptAtUtc);
        }
        else
        {
            logger.LogWarning(
                "Notification event {EventId} retry scheduled: attempt {Attempt} failed ({ErrorType}); next at {NextAttemptAtUtc:O}.",
                retry.EventId, retry.Attempt, retry.InnerException?.GetType().Name, retry.NextAttemptAtUtc);
        }
    }

    /// <summary>Positive ids only, a bounded number - anything else is not a message this worker sent.</summary>
    public static IReadOnlyList<long>? ParseIds(string body)
    {
        var parts = body.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0 || parts.Length > MaxIdsPerDeliveryMessage)
        {
            return null;
        }

        var ids = new List<long>(parts.Length);
        foreach (var part in parts)
        {
            if (!long.TryParse(part, NumberStyles.None, CultureInfo.InvariantCulture, out var id) || id <= 0)
            {
                return null;
            }

            ids.Add(id);
        }

        return ids;
    }
}
