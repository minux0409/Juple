using Juple.Infrastructure.Billing;

namespace Juple.Api.Billing;

/// <summary>
/// Hosts the billing worker (--run-billing-worker): consumes the billing-events queue until the host stops. A crash of the loop stops the
/// host, so Container Apps restarts the replica rather than leaving it alive and idle - SQL keeps every event meanwhile, and the
/// reconcile Job sweeps whatever the worker has not taken.
/// </summary>
public sealed class BillingWorkerService(
    ServiceBusBillingConsumer consumer,
    IHostApplicationLifetime lifetime,
    ILogger<BillingWorkerService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await consumer.RunAsync(stoppingToken);
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogCritical("Billing worker loop failed ({ErrorType}); stopping the host so the replica is restarted.", exception.GetType().Name);
            lifetime.StopApplication();
        }
    }
}
