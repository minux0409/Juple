using System.Globalization;
using Juple.Application.Push;
using Juple.Domain.Notifications;

namespace Juple.Application.Notifications;

/// <summary>
/// One pass of the push-dispatch Job: every not-yet-dispatched social notification is either sent
/// to each of the recipient's enabled devices, skipped (its request/invitation was already answered
/// or is gone, or the recipient has no device) or expired (too old to still be useful). Send-once
/// per (notification, device) is guaranteed by INotificationDeliveryStore.TryClaimAsync, so two
/// overlapping passes never both send. A transient failure leaves the notification pending for the
/// next pass (until it expires); a permanently dead token disables that registration.
/// </summary>
public sealed class DispatchPendingPushNotificationsService(
    IPushDispatchStore dispatchStore,
    INotificationDeliveryStore deliveryStore,
    IPushDeviceRegistrationStore deviceStore,
    IPushSender pushSender,
    TimeProvider timeProvider) : IDispatchPendingPushNotificationsService
{
    public const int BatchSize = 200;

    public async Task<DispatchPendingPushNotificationsResult> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        var pending = await dispatchStore.ListPendingAsync(BatchSize, cancellationToken);
        int sent = 0, failed = 0, skipped = 0, expired = 0;

        foreach (var notification in pending)
        {
            var nowUtc = timeProvider.GetUtcNow();
            if (nowUtc - notification.CreatedAtUtc > SocialNotificationPolicy.MaxAge(notification.Type))
            {
                await dispatchStore.MarkDispatchedAsync(notification.Id, nowUtc, cancellationToken);
                expired++;
                continue;
            }

            var context = await dispatchStore.GetContextAsync(notification, nowUtc, cancellationToken);
            var devices = context.IsRelevant
                ? await deviceStore.ListEnabledAsync(notification.UserId, cancellationToken)
                : [];
            if (devices.Count == 0)
            {
                await dispatchStore.MarkDispatchedAsync(notification.Id, nowUtc, cancellationToken);
                skipped++;
                continue;
            }

            var retryLater = false;
            foreach (var device in devices)
            {
                if (!await deliveryStore.TryClaimAsync(notification.Id, device.Id, timeProvider.GetUtcNow(), cancellationToken))
                {
                    continue;
                }

                var result = await pushSender.SendAsync(device, BuildPayload(notification, context, device.Locale), cancellationToken);
                if (result.Status == NotificationDeliveryStatus.Sent)
                {
                    sent++;
                }
                else
                {
                    failed++;
                    if (PushSendFailureCodes.IsPermanent(result.FailureCode))
                    {
                        await deviceStore.DisableByIdAsync(device.Id, timeProvider.GetUtcNow(), cancellationToken);
                    }
                    else
                    {
                        retryLater = true;
                    }
                }

                await deliveryStore.RecordAttemptAsync(
                    notification.Id, device.Id, result.Status, timeProvider.GetUtcNow(), result.ProviderMessageId, result.FailureCode, cancellationToken);
            }

            if (!retryLater)
            {
                await dispatchStore.MarkDispatchedAsync(notification.Id, timeProvider.GetUtcNow(), cancellationToken);
            }
        }

        return new DispatchPendingPushNotificationsResult(pending.Count, sent, failed, skipped, expired);
    }

    public static PushNotificationPayload BuildPayload(Notification notification, PushDispatchContext context, string locale)
    {
        var data = new Dictionary<string, string>();
        if (notification.CollectionId is { } collectionId)
        {
            data["collectionId"] = collectionId.ToString(CultureInfo.InvariantCulture);
        }

        if (notification.Type == NotificationType.CollectionInvitationAnswered && notification.SubjectId is { } invitationId)
        {
            data["invitationId"] = invitationId.ToString(CultureInfo.InvariantCulture);
        }

        var type = SocialNotificationPolicy.WireType(notification.Type);
        if (SocialNotificationPolicy.IsDataOnly(notification.Type))
        {
            return new PushNotificationPayload(null, null, type, notification.Id, data, BadgeCount: null);
        }

        var (title, body) = SocialPushText.For(
            notification.Type, locale, context.ActorName ?? string.Empty, context.CollectionName ?? string.Empty,
            notification.ItemCount ?? 1, viaPublicLink: notification.ActorUserId is null);
        return new PushNotificationPayload(title, body, type, notification.Id, data, context.BadgeCount);
    }
}
