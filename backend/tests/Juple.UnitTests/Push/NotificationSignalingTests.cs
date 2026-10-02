using System.Diagnostics;
using Azure.Messaging.ServiceBus;
using Juple.Application.Notifications;
using Juple.Infrastructure.Notifications;
using Microsoft.Extensions.Logging.Abstractions;

namespace Juple.UnitTests.Push;

/// <summary>
/// The API's signal path (request → bounded channel → background pump → Service Bus) and the worker's
/// processor settings. What matters: a request never waits on the network, never fails because of
/// signaling, and memory stays bounded; the pump drains in batches and stops within its drain bound.
/// </summary>
public sealed class NotificationSignalingTests
{
    [Fact]
    public void E_TheRequestsSignal_ReturnsAtOnce_WithoutAnyNetworkCall()
    {
        var channel = new NotificationSignalChannel(new NotificationPipelineOptions { SignalChannelCapacity = 10 });
        var signal = new ChannelNotificationSignal(channel, NullLogger<ChannelNotificationSignal>.Instance);

        var task = signal.SignalEventsAsync([1, 2, 3]);

        // Completed synchronously: nothing awaited, nothing sent - only handed to the channel.
        Assert.True(task.IsCompletedSuccessfully);
        Assert.Equal([1L, 2L, 3L], Drain(channel));
    }

    [Fact]
    public void B_AFullChannel_DropsTheSignal_NeverFailsOrBlocksTheRequest()
    {
        var channel = new NotificationSignalChannel(new NotificationPipelineOptions { SignalChannelCapacity = 2 });
        var signal = new ChannelNotificationSignal(channel, NullLogger<ChannelNotificationSignal>.Instance);

        var task = signal.SignalEventsAsync([1, 2, 3, 4]);

        Assert.True(task.IsCompletedSuccessfully);
        Assert.Equal([1L, 2L], Drain(channel)); // bounded: the rest is the recovery Job's
    }

    [Fact]
    public void AClosedChannel_IsShutdown_AndAlsoNeverFailsTheRequest()
    {
        var channel = new NotificationSignalChannel(new NotificationPipelineOptions());
        var signal = new ChannelNotificationSignal(channel, NullLogger<ChannelNotificationSignal>.Instance);
        channel.Complete();

        Assert.True(signal.SignalEventsAsync([5]).IsCompletedSuccessfully);
        Assert.Empty(Drain(channel));
    }

    [Fact]
    public async Task C_ThePump_SendsWhatIsWaiting_InBatches_WithoutWaitingToFillOne()
    {
        var options = new NotificationPipelineOptions { SignalBatchSize = 2 };
        var channel = new NotificationSignalChannel(options);
        var sender = new RecordingSender();
        var pump = new NotificationSignalPump(channel, sender, options, NullLogger<NotificationSignalPump>.Instance);
        foreach (var id in new long[] { 1, 2, 3 })
        {
            channel.TryWrite(id);
        }

        pump.StopAccepting();
        await pump.RunAsync(CancellationToken.None);

        Assert.Equal([[1L, 2L], [3L]], sender.Batches.Select(batch => batch.ToArray()).ToArray());
    }

    [Fact]
    public async Task A_AServiceBusOutage_LosesOnlyTheSignal_AndThePumpKeepsGoing()
    {
        var options = new NotificationPipelineOptions { SignalBatchSize = 1 };
        var channel = new NotificationSignalChannel(options);
        var sender = new RecordingSender { Succeed = false };
        var pump = new NotificationSignalPump(channel, sender, options, NullLogger<NotificationSignalPump>.Instance);
        channel.TryWrite(1);
        channel.TryWrite(2);

        pump.StopAccepting();
        await pump.RunAsync(CancellationToken.None); // no exception

        Assert.Equal(2, sender.Batches.Count); // each attempted once; the events remain in SQL for recovery
    }

    [Fact]
    public async Task OnShutdown_ThePumpStopsAccepting_AndDrainsForAtMostItsBound()
    {
        var options = new NotificationPipelineOptions { SignalBatchSize = 1, SignalDrainSeconds = 1 };
        var channel = new NotificationSignalChannel(options);
        var sender = new HangingSender();
        var pump = new NotificationSignalPump(channel, sender, options, NullLogger<NotificationSignalPump>.Instance);
        for (var id = 1; id <= 5; id++)
        {
            channel.TryWrite(id);
        }

        using var stopping = new CancellationTokenSource();
        stopping.Cancel();
        pump.StopAccepting();
        var watch = Stopwatch.StartNew();
        await pump.RunAsync(stopping.Token);

        Assert.InRange(watch.Elapsed, TimeSpan.Zero, TimeSpan.FromSeconds(5)); // bounded - never holds shutdown
        Assert.False(channel.TryWrite(99)); // no longer accepting
        Assert.Empty(Drain(channel)); // whatever was left is dropped, not kept in memory
    }

    [Fact]
    public void ASignal_IsOnlyTheEventId()
    {
        var message = ServiceBusSignalSender.CreateSignal(42);

        Assert.Equal("42", message.Body.ToString());
        Assert.Equal("ev-42", message.MessageId);
        Assert.Empty(message.ApplicationProperties);
    }

    [Fact]
    public void TheWorkersProcessors_RenewLocksWellBeyondTheQueueLock_WithBoundedConcurrency_AndNoPrefetch()
    {
        var options = new NotificationPipelineOptions();

        var events = ServiceBusNotificationConsumer.CreateProcessorOptions(options, options.EventsMaxConcurrentCalls, "events");
        var deliveries = ServiceBusNotificationConsumer.CreateProcessorOptions(options, options.DeliveriesMaxConcurrentCalls, "deliveries");

        foreach (var processor in new[] { events, deliveries })
        {
            Assert.False(processor.AutoCompleteMessages);
            Assert.Equal(ServiceBusReceiveMode.PeekLock, processor.ReceiveMode);
            Assert.Equal(0, processor.PrefetchCount);
            Assert.Equal(TimeSpan.FromSeconds(options.MaxAutoLockRenewalSeconds), processor.MaxAutoLockRenewalDuration);
            // A handler may run far longer than one lock period without losing its message...
            Assert.True(processor.MaxAutoLockRenewalDuration > TimeSpan.FromSeconds(options.QueueLockDurationSeconds) * 5);
            // ...but renewal is finite.
            Assert.NotEqual(Timeout.InfiniteTimeSpan, processor.MaxAutoLockRenewalDuration);
        }

        Assert.Equal(options.EventsMaxConcurrentCalls, events.MaxConcurrentCalls);
        Assert.Equal(options.DeliveriesMaxConcurrentCalls, deliveries.MaxConcurrentCalls);
        Assert.Equal("juple-notification-worker-events", events.Identifier);
    }

    [Fact]
    public void AMisconfiguredRenewal_StillNeverDropsBelowTwiceTheQueueLock()
    {
        var options = new NotificationPipelineOptions { MaxAutoLockRenewalSeconds = 10, QueueLockDurationSeconds = 60 };

        Assert.Equal(TimeSpan.FromSeconds(120), ServiceBusNotificationConsumer.CreateProcessorOptions(options, 1, "events").MaxAutoLockRenewalDuration);
    }

    private static List<long> Drain(NotificationSignalChannel channel)
    {
        var ids = new List<long>();
        while (channel.Reader.TryRead(out var id))
        {
            ids.Add(id);
        }

        return ids;
    }

    private sealed class RecordingSender : INotificationSignalSender
    {
        public bool Succeed { get; init; } = true;

        public List<IReadOnlyList<long>> Batches { get; } = [];

        public Task<bool> SendAsync(IReadOnlyList<long> eventIds, CancellationToken cancellationToken)
        {
            Batches.Add(eventIds.ToList());
            return Task.FromResult(Succeed);
        }
    }

    /// <summary>A Service Bus that never answers - only the caller's cancellation ends a send.</summary>
    private sealed class HangingSender : INotificationSignalSender
    {
        public async Task<bool> SendAsync(IReadOnlyList<long> eventIds, CancellationToken cancellationToken)
        {
            await Task.Delay(Timeout.Infinite, cancellationToken);
            return true;
        }
    }
}
