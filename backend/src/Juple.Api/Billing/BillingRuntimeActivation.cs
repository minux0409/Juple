using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;

namespace Juple.Api.Billing;

/// <summary>
/// The one activation boundary of the billing runtimes (--run-billing-worker / --run-billing-reconcile), decided by the existing
/// Billing:Google:Enabled switch alone (Billing:ProgramEnabled stays independent).
///
/// Disabled: both runtimes are deployable and inert - the worker starts and idles (no Service Bus processor, no Google client, no
/// credential or key read) and a reconcile run logs that it is disabled and exits 0 without touching Google or SQL. None of the Google /
/// billing-event settings is required, so the templates wire none of them.
/// Enabled: unchanged - every Google setting and secret is required (BillingOptionsValidator.ValidateGoogle) and the worker also needs
/// the billing-events namespace; a missing one stops the process before any work, naming the setting.
/// </summary>
public static class BillingRuntimeActivation
{
    /// <summary>The worker's hosted service: the billing-events consumer when enabled, an idle placeholder otherwise.</summary>
    public static void AddBillingWorker(IServiceCollection services, BillingOptions options)
    {
        if (options.Google.Enabled)
        {
            services.AddHostedService<BillingWorkerService>();
        }
        else
        {
            services.AddHostedService<DisabledBillingWorkerService>();
        }
    }

    /// <summary>What the worker needs beyond ValidateGoogle: the queue namespace - only when it will consume it.</summary>
    public static void EnsureWorkerConfiguration(BillingOptions options)
    {
        if (options.Google.Enabled && string.IsNullOrWhiteSpace(options.Events.ServiceBusNamespace))
        {
            throw new InvalidOperationException(
                "Billing:Events:ServiceBusNamespace must be configured for --run-billing-worker when Billing:Google:Enabled is true.");
        }
    }

    /// <summary>
    /// One bounded reconcile pass (events whose wake-up was lost, purchases whose re-check is due). Disabled: nothing is resolved
    /// beyond the options and a logger - no Google call, no billing write - and the run succeeds. Returns the process exit code.
    /// </summary>
    public static async Task<int> RunReconcileOnceAsync(IServiceProvider rootServices)
    {
        await using var scope = rootServices.CreateAsyncScope();
        var logger = scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("BillingReconcileJob");
        var billing = scope.ServiceProvider.GetRequiredService<BillingOptions>();
        if (!billing.Google.Enabled)
        {
            logger.LogInformation("Google billing is not enabled; billing reconciliation is disabled and nothing was done.");
            return 0;
        }

        try
        {
            // Bounded on purpose: the cadence per purchase is set by the purchase itself (see GooglePurchaseNormalizer), never a hot loop.
            var summary = await scope.ServiceProvider.GetRequiredService<IGoogleBillingProcessor>().SweepAsync(eventLimit: 100, purchaseLimit: 100);
            logger.LogInformation(
                "Billing reconcile complete. EventsProcessed={EventsProcessed} PurchasesReconciled={PurchasesReconciled} Failures={Failures}",
                summary.EventsProcessed, summary.PurchasesReconciled, summary.Failures);
            return 0;
        }
        catch (Exception exception)
        {
            logger.LogError("Billing reconcile run failed ({ErrorType}).", exception.GetType().Name);
            return 1;
        }
    }
}

/// <summary>
/// The billing worker while Billing:Google:Enabled is false: says so once and waits for the host to stop. It depends on nothing but a
/// logger, so no Service Bus client, Google client, credential or key is ever built, and it neither polls nor exits (an exiting process
/// would only make Container Apps restart it over and over).
/// </summary>
public sealed class DisabledBillingWorkerService(ILogger<DisabledBillingWorkerService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Google billing is not enabled; the billing worker is idle and consumes no billing events.");
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // The host is stopping - the normal end of an idle worker.
        }
    }
}
