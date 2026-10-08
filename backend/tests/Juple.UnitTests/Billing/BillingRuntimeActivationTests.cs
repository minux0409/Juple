using Juple.Api.Billing;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.UnitTests.Billing.GooglePlay;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Juple.UnitTests.Billing;

/// <summary>
/// The billing runtimes' activation boundary (Billing:Google:Enabled). Disabled runs in a container that has NO billing infrastructure
/// registered at all - no Service Bus consumer, no Google client, no credential source, no store - so any attempt to build one fails
/// the test: being deployable while disabled means needing none of them.
/// </summary>
public sealed class BillingRuntimeActivationTests
{
    private static BillingOptions Disabled() => new() { Google = new GoogleBillingOptions { Enabled = false } };

    private static ServiceProvider Bare(BillingOptions options, Action<IServiceCollection>? extra = null)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton(options);
        extra?.Invoke(services);
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = false, ValidateScopes = true });
    }

    // ---- worker ----------------------------------------------------------------------------------------------------------------

    [Fact]
    public void DisabledWorker_RegistersOnlyTheIdlePlaceholder_NotTheConsumer()
    {
        var services = new ServiceCollection();
        BillingRuntimeActivation.AddBillingWorker(services, Disabled());

        var hosted = Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
        Assert.Equal(typeof(DisabledBillingWorkerService), hosted.ImplementationType);
        Assert.DoesNotContain(services, descriptor => descriptor.ImplementationType == typeof(BillingWorkerService));
    }

    [Fact]
    public void DisabledWorker_NeedsNoNamespace_AndNoGoogleSetting()
    {
        // Nothing configured: no namespace, no product, no credential, no key.
        var options = Disabled();

        BillingRuntimeActivation.EnsureWorkerConfiguration(options);
        BillingOptionsValidator.ValidateGoogle(options);
        BillingOptionsValidator.Validate(options);
    }

    [Fact]
    public async Task DisabledWorker_StartsAndStaysIdle_WithoutBuildingAnyBillingDependency_ThenStopsOnShutdown()
    {
        var options = Disabled();
        await using var provider = Bare(options, services => BillingRuntimeActivation.AddBillingWorker(services, options));

        // Resolving it needs only a logger - the container has no Service Bus / Google registration to build.
        var worker = Assert.IsType<DisabledBillingWorkerService>(Assert.Single(provider.GetServices<IHostedService>()));
        await worker.StartAsync(CancellationToken.None);

        // Still running a while later: it neither exits (which would make Container Apps restart it) nor fails.
        await Task.Delay(200);
        Assert.NotNull(worker.ExecuteTask);
        Assert.False(worker.ExecuteTask!.IsCompleted);

        // The host stopping ends it promptly and cleanly.
        var stopping = worker.StopAsync(CancellationToken.None);
        Assert.Same(stopping, await Task.WhenAny(stopping, Task.Delay(TimeSpan.FromSeconds(5))));
        Assert.True(worker.ExecuteTask.IsCompletedSuccessfully);
    }

    [Fact]
    public void EnabledWorker_RegistersTheBillingEventsConsumer()
    {
        var services = new ServiceCollection();
        BillingRuntimeActivation.AddBillingWorker(services, GoogleTestData.Options());

        var hosted = Assert.Single(services, descriptor => descriptor.ServiceType == typeof(IHostedService));
        Assert.Equal(typeof(BillingWorkerService), hosted.ImplementationType);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void EnabledWorker_WithoutTheQueueNamespace_FailsFast_NamingTheSetting(string? serviceBusNamespace)
    {
        var options = GoogleTestData.Options();
        options.Events.ServiceBusNamespace = serviceBusNamespace;

        var exception = Assert.Throws<InvalidOperationException>(() => BillingRuntimeActivation.EnsureWorkerConfiguration(options));
        Assert.Contains("Billing:Events:ServiceBusNamespace", exception.Message, StringComparison.Ordinal);
    }

    [Fact]
    public void EnabledWorker_FullyConfigured_IsAccepted()
    {
        var options = GoogleTestData.Options();
        options.Events.ServiceBusNamespace = "sb-example.servicebus.windows.net";

        BillingRuntimeActivation.EnsureWorkerConfiguration(options);
        BillingOptionsValidator.ValidateGoogle(options);
    }

    // ---- reconcile -------------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task DisabledReconcile_Succeeds_WithNoProcessorRegisteredAtAll()
    {
        await using var provider = Bare(Disabled());

        Assert.Equal(0, await BillingRuntimeActivation.RunReconcileOnceAsync(provider));
    }

    [Fact]
    public async Task DisabledReconcile_NeverBuildsOrCallsTheProcessor_SoNoGoogleCallAndNoBillingWrite()
    {
        var processor = new CountingProcessor();
        var constructed = 0;
        await using var provider = Bare(Disabled(), services => services.AddScoped<IGoogleBillingProcessor>(_ =>
        {
            constructed++;
            return processor;
        }));

        Assert.Equal(0, await BillingRuntimeActivation.RunReconcileOnceAsync(provider));
        Assert.Equal(0, constructed);
        Assert.Equal(0, processor.Calls);
    }

    [Fact]
    public async Task EnabledReconcile_RunsOneBoundedSweep()
    {
        var processor = new CountingProcessor();
        await using var provider = Bare(GoogleTestData.Options(), services => services.AddScoped<IGoogleBillingProcessor>(_ => processor));

        Assert.Equal(0, await BillingRuntimeActivation.RunReconcileOnceAsync(provider));
        Assert.Equal(1, processor.Calls);
        Assert.Equal((100, 100), processor.LastLimits);
    }

    [Fact]
    public async Task EnabledReconcile_AFailedSweep_IsAFailedRun()
    {
        var processor = new CountingProcessor { Throw = true };
        await using var provider = Bare(GoogleTestData.Options(), services => services.AddScoped<IGoogleBillingProcessor>(_ => processor));

        Assert.Equal(1, await BillingRuntimeActivation.RunReconcileOnceAsync(provider));
        Assert.Equal(1, processor.Calls);
    }

    /// <summary>Counts every call; nothing here reaches Google or SQL.</summary>
    private sealed class CountingProcessor : IGoogleBillingProcessor
    {
        public int Calls { get; private set; }
        public (int Events, int Purchases) LastLimits { get; private set; }
        public bool Throw { get; init; }

        public Task<StoreEventInsertResult> IngestAsync(string messageId, GoogleNotification notification, CancellationToken cancellationToken = default)
            => throw Unexpected();

        public Task<ProcessOutcome> ProcessEventAsync(long eventId, CancellationToken cancellationToken = default) => throw Unexpected();

        public Task<ProcessOutcome> ReconcilePurchaseAsync(long purchaseId, CancellationToken cancellationToken = default) => throw Unexpected();

        public Task<SweepSummary> SweepAsync(int eventLimit, int purchaseLimit, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastLimits = (eventLimit, purchaseLimit);
            return Throw ? throw new InvalidOperationException("sweep failed") : Task.FromResult(new SweepSummary(0, 0, 0));
        }

        private InvalidOperationException Unexpected()
        {
            Calls++;
            return new InvalidOperationException("The reconcile run only sweeps.");
        }
    }
}
