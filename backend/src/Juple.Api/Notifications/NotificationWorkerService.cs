using Juple.Infrastructure.Notifications;

namespace Juple.Api.Notifications;

/// <summary>
/// Hosts the notification worker (--run-notification-worker): consumes the notification-events and
/// push-deliveries queues until the host stops (graceful: no new messages, in-flight handlers finish
/// or their message locks expire and Service Bus redelivers). A crash of the loop stops the host, so
/// Container Apps restarts the replica rather than leaving it alive and idle.
/// </summary>
public sealed class NotificationWorkerService(
    ServiceBusNotificationConsumer consumer,
    IHostApplicationLifetime lifetime,
    ILogger<NotificationWorkerService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await consumer.RunAsync(stoppingToken);
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogCritical("Notification worker loop failed ({ErrorType}); stopping the host so the replica is restarted.", exception.GetType().Name);
            lifetime.StopApplication();
        }
    }
}
