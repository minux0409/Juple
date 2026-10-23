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
        var isDataOnly = payload.Title is null || payload.Body is null;
        var message = new Message
        {
            // The device registers an FCM registration token (getToken on the client), which is what Message.Token targets. The SDK's
            // suggested replacement, Fid, is a Firebase Installation ID - a different identifier the app does not send - so switching
            // would need a client change first (post-launch follow-up). Token keeps working for registration tokens.
#pragma warning disable CS0618
            Token = device.PushToken,
#pragma warning restore CS0618
            // Data-only (a refresh signal for an open screen): no tray notification, normal priority.
            Notification = isDataOnly ? null : new Notification { Title = payload.Title, Body = payload.Body },
            Data = BuildDataPayload(payload),
            Android = isDataOnly
                ? new AndroidConfig { Priority = Priority.Normal }
                : new AndroidConfig
                {
                    Priority = Priority.High,
                    // Launchers that show numeric badges use this; many only show a dot. The in-app
                    // badges stay the source of truth.
                    Notification = new AndroidNotification
                    {
                        NotificationCount = payload.BadgeCount,
                        // Same logical notification replaces its own tray entry on a provider
                        // replay; different persisted notifications always have different tags.
                        Tag = "juple.notification." + payload.NotificationId.ToString(CultureInfo.InvariantCulture),
                        // The Admin SDK always sends event_time and the Android SDK then uses it as the tray time
                        // (setWhen/setShowWhen). Left unset it is DateTime.MinValue - "year 1" on the phone - so it is
                        // always the notification's own creation time (UTC), or the send time.
                        EventTimestamp = (payload.OccurredAtUtc ?? DateTimeOffset.UtcNow).UtcDateTime,
                    },
                },
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

    internal static IReadOnlyDictionary<string, string> BuildDataPayload(PushNotificationPayload payload)
    {
        var data = new Dictionary<string, string>(payload.Data)
        {
            ["type"] = payload.Type,
            ["notificationId"] = payload.NotificationId.ToString(CultureInfo.InvariantCulture),
        };
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
