using System.Globalization;
using Azure.Identity;
using Azure.Messaging.ServiceBus;
using Google.Apis.Auth;
using Juple.Application.Billing;
using Juple.Application.Billing.GooglePlay;
using Juple.Domain.Billing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Billing;

/// <summary>
/// Sends the wake-up for a stored billing event to the <c>billing-events</c> queue. The message body is ONLY the internal event id -
/// never a purchase token. One ServiceBusClient for the process (thread-safe, pooled), authenticated with DefaultAzureCredential
/// (the user-assigned Managed Identity, holding only the Sender role on this queue). Best effort and bounded: a failure or timeout
/// returns false and loses nothing - the event is already committed in SQL and the sweep recovers it.
/// </summary>
public sealed class ServiceBusBillingEventSignal(BillingOptions options, ILogger<ServiceBusBillingEventSignal> logger) : IBillingEventSignal, IAsyncDisposable
{
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(3);
    private readonly Lazy<ServiceBusClient> _client = new(() => new ServiceBusClient(options.Events.ServiceBusNamespace, new DefaultAzureCredential()));
    private ServiceBusSender? _sender;
    private readonly object _gate = new();

    public async Task<bool> TrySignalAsync(long eventId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(options.Events.ServiceBusNamespace))
        {
            return false;
        }

        try
        {
            ServiceBusSender sender;
            lock (_gate)
            {
                sender = _sender ??= _client.Value.CreateSender(options.Events.QueueName);
            }

            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(SendTimeout);
            await sender.SendMessageAsync(new ServiceBusMessage(eventId.ToString(CultureInfo.InvariantCulture)), timeout.Token);
            return true;
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            logger.LogWarning("Billing event {EventId} could not be signalled ({ErrorType}); the SQL event remains and the sweep will process it.", eventId, exception.GetType().Name);
            return false;
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_client.IsValueCreated)
        {
            await _client.Value.DisposeAsync();
        }
    }
}

/// <summary>Used where no queue is configured (local development, tests): nothing is signalled, the sweep does all the work.</summary>
public sealed class NullBillingEventSignal : IBillingEventSignal
{
    public Task<bool> TrySignalAsync(long eventId, CancellationToken cancellationToken = default) => Task.FromResult(false);
}

/// <summary>
/// The billing worker's consumer (<c>--run-billing-worker</c>): one message = one stored event id. Settlement is explicit; a transient
/// failure is rescheduled in SQL (back-off) and the message completed, an unexpected failure leaves the message to be redelivered, and
/// a malformed body goes to the dead-letter queue - which never invalidates the SQL event.
/// </summary>
public sealed class ServiceBusBillingConsumer(
    BillingOptions options,
    IServiceScopeFactory scopeFactory,
    ILogger<ServiceBusBillingConsumer> logger)
{
    public async Task RunAsync(CancellationToken stoppingToken)
    {
        await using var client = new ServiceBusClient(options.Events.ServiceBusNamespace, new DefaultAzureCredential());
        await using var processor = client.CreateProcessor(options.Events.QueueName, new ServiceBusProcessorOptions
        {
            AutoCompleteMessages = false,
            ReceiveMode = ServiceBusReceiveMode.PeekLock,
            MaxConcurrentCalls = 4,
            PrefetchCount = 0,
            MaxAutoLockRenewalDuration = TimeSpan.FromMinutes(5),
            Identifier = "juple-billing-worker",
        });
        processor.ProcessMessageAsync += HandleAsync;
        processor.ProcessErrorAsync += args =>
        {
            logger.LogWarning("Billing worker Service Bus error ({ErrorSource}, {ErrorType}).", args.ErrorSource, args.Exception.GetType().Name);
            return Task.CompletedTask;
        };

        await processor.StartProcessingAsync(stoppingToken);
        logger.LogInformation("Billing worker started.");
        try
        {
            await Task.Delay(Timeout.Infinite, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            // Shutting down: stop taking messages; in-flight handlers finish or their locks expire.
        }

        await processor.StopProcessingAsync(CancellationToken.None);
        logger.LogInformation("Billing worker stopped.");
    }

    private async Task HandleAsync(ProcessMessageEventArgs args)
    {
        if (!long.TryParse(args.Message.Body.ToString(), NumberStyles.None, CultureInfo.InvariantCulture, out var eventId) || eventId <= 0)
        {
            await args.DeadLetterMessageAsync(args.Message, "MalformedBody", "Not a billing event id.", args.CancellationToken);
            return;
        }

        try
        {
            await using var scope = scopeFactory.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<IGoogleBillingProcessor>().ProcessEventAsync(eventId, args.CancellationToken);
            // Whatever the outcome (processed, not due, taken by another, retry scheduled in SQL), this message's job - waking a
            // processor - is done; SQL owns the rest.
            await args.CompleteMessageAsync(args.Message, args.CancellationToken);
        }
        catch (Exception exception) when (!args.CancellationToken.IsCancellationRequested)
        {
            logger.LogWarning(
                "Billing event {EventId} failed unexpectedly ({ErrorType}), delivery {DeliveryCount}; the message will be redelivered and the event stays in SQL.",
                eventId, exception.GetType().Name, args.Message.DeliveryCount);
        }
    }
}

/// <summary>Structured, redacted operational logging for billing. Only ids, normalized states and codes - never a token, credential, JWT or header.</summary>
public sealed class BillingTelemetry(ILogger<BillingTelemetry> logger) : IBillingTelemetry
{
    public void VerifyCompleted(long purchaseId, GoogleVerifyOutcome outcome, StorePurchaseState state) =>
        logger.LogInformation("billing.google.verify.completed PurchaseId={PurchaseId} Outcome={Outcome} State={State}", purchaseId, outcome, state);

    public void VerifyRejected(string reason) =>
        logger.LogWarning("billing.google.verify.rejected Reason={Reason}", reason);

    public void PurchaseConflict(string operation) =>
        logger.LogWarning("billing.google.purchase.conflict Operation={Operation}", operation);

    public void GoogleCallFailed(string operation, string errorType) =>
        logger.LogWarning("billing.google.call.failed Operation={Operation} ErrorType={ErrorType}", operation, errorType);

    public void AcknowledgeFailed(long purchaseId) =>
        logger.LogWarning("billing.google.acknowledge.failed PurchaseId={PurchaseId}", purchaseId);

    public void EventIngested(long eventId, bool isNew, string eventType) =>
        logger.LogInformation("billing.rtdn.ingested EventId={EventId} IsNew={IsNew} EventType={EventType}", eventId, isNew, eventType);

    public void EventProcessed(long eventId, StoreEventResult result) =>
        logger.LogInformation("billing.rtdn.processed EventId={EventId} Result={Result}", eventId, result);

    public void EventRetryScheduled(long eventId, int attempt, string errorCode) =>
        logger.LogWarning("billing.rtdn.retry EventId={EventId} Attempt={Attempt} ErrorCode={ErrorCode}", eventId, attempt, errorCode);

    public void PurchaseReconciled(long purchaseId, StorePurchaseState from, StorePurchaseState to) =>
        logger.LogInformation("billing.google.reconciled PurchaseId={PurchaseId} From={From} To={To}", purchaseId, from, to);
}

/// <summary>
/// Authenticates Google Pub/Sub push: the OIDC token Pub/Sub attaches is verified against Google's published keys (signature, issuer,
/// expiry) with the library's own validator, then its audience must be the configured webhook audience and it must be issued for the
/// configured, verified push service account. Anything else is refused BEFORE the body is parsed. The token is never logged or kept.
/// </summary>
public sealed class GooglePubSubOidcAuthenticator(BillingOptions options) : IPubSubPushAuthenticator
{
    public async Task<bool> AuthenticateAsync(string? authorizationHeader, CancellationToken cancellationToken = default)
    {
        const string prefix = "Bearer ";
        if (string.IsNullOrWhiteSpace(authorizationHeader)
            || !authorizationHeader.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            || string.IsNullOrWhiteSpace(options.Google.PubSub.Audience)
            || string.IsNullOrWhiteSpace(options.Google.PubSub.PushServiceAccountEmail))
        {
            return false;
        }

        var jwt = authorizationHeader[prefix.Length..].Trim();
        try
        {
            var payload = await GoogleJsonWebSignature.ValidateAsync(
                jwt, new GoogleJsonWebSignature.ValidationSettings { Audience = [options.Google.PubSub.Audience] });
            return payload.EmailVerified
                && string.Equals(payload.Email, options.Google.PubSub.PushServiceAccountEmail, StringComparison.OrdinalIgnoreCase);
        }
        catch (InvalidJwtException)
        {
            return false;
        }
    }
}
