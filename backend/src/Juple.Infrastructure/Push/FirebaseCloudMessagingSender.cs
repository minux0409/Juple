using System.Globalization;
using FirebaseAdmin;
using FirebaseAdmin.Messaging;
using Juple.Application.Push;
using Juple.Domain.Push;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The Android IPushSender: sends directly through FCM v1 via the official Firebase Admin .NET SDK
/// (FirebaseMessaging.SendAsync) - never Azure Notification Hubs (see docs/architecture.md) and
/// never the legacy FCM server-key API. Authenticates via the FirebaseApp singleton constructed in
/// DependencyInjection.AddInfrastructure from a service-account credential
/// (Firebase:ServiceAccountKeyJson) - this class itself never reads configuration directly.
///
/// Every send failure is classified into one of PushSendFailureCodes' transport-agnostic codes and
/// returned as a Failed PushSendResult, never thrown - DispatchDuePushNotificationsService is what
/// decides retry vs. registration-disable policy from that code (see PushSendFailureCodes' own
/// remarks on why only UNREGISTERED/SENDER_ID_MISMATCH are treated as permanent).
/// </summary>
public sealed class FirebaseCloudMessagingSender : IPushSender
{
    /// <summary>
    /// Well under NotificationDeliveryStore.StaleSendingLeaseTimeout (15 minutes) - a hung FCM call
    /// must fail (and free its claim for the next dispatch pass to retry) long before another worker
    /// would ever consider this delivery's lease stale and reclaim it out from under this attempt.
    /// FirebaseMessaging.SendAsync has no built-in timeout of its own (confirmed against the SDK's
    /// public API - it only accepts a CancellationToken), so this class supplies one itself rather
    /// than risking an indefinitely hanging HTTP call.
    /// </summary>
    private static readonly TimeSpan SendTimeout = TimeSpan.FromSeconds(20);

    private readonly FirebaseMessaging messaging;

    public FirebaseCloudMessagingSender(FirebaseApp firebaseApp)
    {
        messaging = FirebaseMessaging.GetMessaging(firebaseApp);
    }

    public async Task<PushSendResult> SendAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default)
    {
        var message = new Message
        {
            Token = device.PushToken,
            Notification = new Notification
            {
                Title = payload.Title,
                Body = payload.Body,
            },
            Data = BuildDataPayload(payload),
        };

        using var timeoutCts = new CancellationTokenSource(SendTimeout);
        using var linkedCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeoutCts.Token);

        try
        {
            var providerMessageId = await messaging.SendAsync(message, linkedCts.Token);
            return PushSendResult.Sent(providerMessageId);
        }
        catch (FirebaseMessagingException exception)
        {
            // Never logs/includes device.PushToken or exception.Message (which some FCM error
            // responses embed the token fragment into) - only the classified code.
            return PushSendResult.Failed(MapFailureCode(exception.MessagingErrorCode));
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            // linkedCts tripped from timeoutCts, not the caller's own cancellationToken - this
            // call's own SendTimeout elapsed. Always transient, never a token problem.
            return PushSendResult.Failed(PushSendFailureCodes.SendTimeout);
        }
    }

    private static IReadOnlyDictionary<string, string> BuildDataPayload(PushNotificationPayload payload)
    {
        var data = new Dictionary<string, string>
        {
            ["type"] = payload.Type,
            ["notificationId"] = payload.NotificationId.ToString(CultureInfo.InvariantCulture),
        };

        if (payload.RepeatPurchaseId is { } repeatPurchaseId)
        {
            data["repeatPurchaseId"] = repeatPurchaseId.ToString(CultureInfo.InvariantCulture);
        }

        if (payload.ItemId is { } itemId)
        {
            data["itemId"] = itemId.ToString(CultureInfo.InvariantCulture);
        }

        return data;
    }

    /// <summary>
    /// Maps FCM's own MessagingErrorCode enum down to PushSendFailureCodes' transport-agnostic
    /// vocabulary - see that type's own remarks on which of these are treated as permanent.
    /// </summary>
    private static string MapFailureCode(MessagingErrorCode? errorCode) => errorCode switch
    {
        MessagingErrorCode.Unregistered => PushSendFailureCodes.Unregistered,
        MessagingErrorCode.SenderIdMismatch => PushSendFailureCodes.SenderIdMismatch,
        MessagingErrorCode.InvalidArgument => PushSendFailureCodes.InvalidArgument,
        MessagingErrorCode.QuotaExceeded => PushSendFailureCodes.QuotaExceeded,
        MessagingErrorCode.Unavailable => PushSendFailureCodes.Unavailable,
        MessagingErrorCode.Internal => PushSendFailureCodes.Internal,
        MessagingErrorCode.ThirdPartyAuthError => PushSendFailureCodes.ThirdPartyAuthError,
        _ => PushSendFailureCodes.UnknownError,
    };
}
