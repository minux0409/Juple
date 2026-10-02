using Juple.Application.Notifications;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Notifications;

/// <summary>Sends a batch of outbox event-id signals; false when it could not (the events stay for the recovery Job). Never throws.</summary>
public interface INotificationSignalSender
{
    Task<bool> SendAsync(IReadOnlyList<long> eventIds, CancellationToken cancellationToken);
}

/// <summary>
/// The API's background signal publisher loop (hosted by Juple.Api's NotificationSignalPublisherService):
/// drains the in-process signal channel into Service Bus - off every request's path. Whatever is
/// waiting is sent at once (up to SignalBatchSize per send - a lone signal never waits to fill a batch).
/// A failed send is logged and dropped: the events are durable in SQL and the recovery Job processes
/// them. On shutdown the channel stops accepting (Complete), and what is already queued gets one
/// bounded drain (SignalDrainSeconds); anything left is, again, the recovery Job's.
/// </summary>
public sealed class NotificationSignalPump(
    NotificationSignalChannel channel,
    INotificationSignalSender sender,
    NotificationPipelineOptions options,
    ILogger<NotificationSignalPump> logger)
{
    public async Task RunAsync(CancellationToken stoppingToken)
    {
        try
        {
            while (await channel.Reader.WaitToReadAsync(stoppingToken))
            {
                // Not the stopping token: a batch already taken out of the channel is sent (bounded by
                // the sender's own timeout) rather than abandoned half-way.
                await SendWaitingAsync(CancellationToken.None);
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // Stopping - fall through to the bounded drain.
        }

        await DrainAsync();
    }

    /// <summary>Stops accepting new signals - requests from now on leave their events to the recovery Job.</summary>
    public void StopAccepting() => channel.Complete();

    /// <summary>Sends what is still queued, for at most SignalDrainSeconds.</summary>
    public async Task DrainAsync()
    {
        using var drain = new CancellationTokenSource(TimeSpan.FromSeconds(Math.Max(0, options.SignalDrainSeconds)));
        try
        {
            while (!drain.IsCancellationRequested && channel.Reader.TryPeek(out _))
            {
                await SendWaitingAsync(drain.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // Out of drain time.
        }

        var left = 0;
        while (channel.Reader.TryRead(out _))
        {
            left++;
        }

        if (left > 0)
        {
            logger.LogWarning("Notification signal publisher stopped with {SignalCount} signals unsent; the recovery Job will process those events.", left);
        }
    }

    private async Task SendWaitingAsync(CancellationToken cancellationToken)
    {
        var batch = new List<long>(Math.Max(1, options.SignalBatchSize));
        while (batch.Count < Math.Max(1, options.SignalBatchSize) && channel.Reader.TryRead(out var eventId))
        {
            batch.Add(eventId);
        }

        if (batch.Count > 0)
        {
            await sender.SendAsync(batch, cancellationToken);
        }
    }
}
