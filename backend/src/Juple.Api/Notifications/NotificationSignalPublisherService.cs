using Juple.Infrastructure.Notifications;

namespace Juple.Api.Notifications;

/// <summary>
/// Hosts the API's background notification-signal publisher (NotificationSignalPump): requests only
/// hand committed outbox event ids to an in-process channel; this sends them to Service Bus in the
/// background. Registered only for the HTTP API with a Service Bus namespace configured.
/// </summary>
public sealed class NotificationSignalPublisherService(NotificationSignalPump pump) : BackgroundService
{
    protected override Task ExecuteAsync(CancellationToken stoppingToken) => pump.RunAsync(stoppingToken);

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        // No new signals from here on; then the loop gets its bounded drain.
        pump.StopAccepting();
        await base.StopAsync(cancellationToken);
    }
}
