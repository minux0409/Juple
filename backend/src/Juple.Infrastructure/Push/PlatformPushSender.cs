using Juple.Application.Push;
using Juple.Domain.Push;
using Microsoft.Extensions.Logging;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The one IPushSender the dispatch pipeline sees: each device goes to its own platform's transport - Android to FCM (exactly the
/// sender it always used, called the same way), iOS to APNs. Either transport may be unconfigured (NotConfiguredPushSender).
///
/// Isolation: the pipeline sends a batch in parallel and treats an exception as a programmer error that fails the batch. So an
/// unexpected exception from the newer APNs transport is turned into an ordinary failed attempt for that one iOS device (logged,
/// retried by the pipeline like any transient failure) and can never stop an Android delivery of the same batch. The FCM path is not
/// wrapped - its behaviour is unchanged.
/// </summary>
public sealed partial class PlatformPushSender(IPushSender androidSender, IPushSender iosSender, ILogger<PlatformPushSender> logger) : IPushSender
{
    /// <summary>The Android transport (FCM, or not configured) - exposed for wiring checks only.</summary>
    public IPushSender AndroidSender => androidSender;

    /// <summary>The iOS transport (APNs, or not configured) - exposed for wiring checks only.</summary>
    public IPushSender IosSender => iosSender;

    public Task<PushSendResult> SendAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default) =>
        device.Platform switch
        {
            PushPlatform.Android => androidSender.SendAsync(device, payload, cancellationToken),
            PushPlatform.Ios => SendIsolatedAsync(device, payload, cancellationToken),
            _ => Task.FromResult(PushSendResult.Failed(PushSendFailureCodes.TransportNotConfigured)),
        };

    private async Task<PushSendResult> SendIsolatedAsync(PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken)
    {
        try
        {
            return await iosSender.SendAsync(device, payload, cancellationToken);
        }
        catch (Exception exception) when (exception is not OperationCanceledException || !cancellationToken.IsCancellationRequested)
        {
            Log.IosSendFailed(logger, device.Id, exception.GetType().Name);
            return PushSendResult.Failed(PushSendFailureCodes.UnknownError);
        }
    }

    private static partial class Log
    {
        [LoggerMessage(EventId = 7303, Level = LogLevel.Error, Message = "The iOS push transport failed unexpectedly for registration {RegistrationId} ({ExceptionType}); recorded as a failed attempt.")]
        public static partial void IosSendFailed(ILogger logger, long registrationId, string exceptionType);
    }
}
