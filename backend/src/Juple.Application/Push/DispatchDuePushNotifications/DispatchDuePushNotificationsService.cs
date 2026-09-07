using Juple.Application.Notifications;
using Juple.Domain.Notifications;

namespace Juple.Application.Push.DispatchDuePushNotifications;

/// <summary>
/// Materialize-then-dispatch, kept as two clearly separate steps per user (see this feature's own
/// design notes): first the exact same INotificationStore.MaterializeDueAsync the lazy in-app path
/// already uses (so a due RepeatPurchase becomes a Notification row the same way regardless of
/// which path noticed it first), then - only after that succeeds - candidate selection and Push
/// send for whatever is unread and not yet attempted. A send failure only ever affects its own
/// NotificationDelivery row; it can never roll back or delete the Notification row that already
/// committed, since materialization and dispatch are different store calls, not one transaction.
/// </summary>
public sealed class DispatchDuePushNotificationsService(
    INotificationStore notificationStore,
    INotificationDeliveryStore notificationDeliveryStore,
    IPushDeviceRegistrationStore pushDeviceRegistrationStore,
    IPushSender pushSender,
    TimeProvider timeProvider) : IDispatchDuePushNotificationsService
{
    public async Task<DispatchDuePushNotificationsResult> DispatchAsync(CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var candidates = await notificationStore.ListUsersWithDueRepeatPurchasesAsync(nowUtc, cancellationToken);

        var attempted = 0;
        var sent = 0;
        var failed = 0;
        var skipped = 0;

        foreach (var (userId, timeZoneId) in candidates)
        {
            await notificationStore.MaterializeDueAsync(userId, timeZoneId, nowUtc, cancellationToken);

            var pending = await notificationDeliveryStore.GetPendingAsync(userId, cancellationToken);
            foreach (var (notification, device) in pending)
            {
                // GetPendingAsync is a coarse candidate list, not a claim - a concurrent dispatch
                // pass may have already claimed (or even finished) this exact pair by now. This is
                // the actual concurrency guard: only the caller that wins the claim ever calls
                // pushSender.SendAsync for it (see TryClaimAsync's own remarks).
                var claimed = await notificationDeliveryStore.TryClaimAsync(
                    notification.Id, device.Id, timeProvider.GetUtcNow(), cancellationToken);
                if (!claimed)
                {
                    skipped++;
                    continue;
                }

                var (title, body) = PushNotificationTextGenerator.Generate(notification, device.Locale);
                var payload = new PushNotificationPayload(
                    title,
                    body,
                    "repeatPurchaseDue",
                    notification.Id,
                    notification.RepeatPurchaseId,
                    notification.ItemId);

                var result = await pushSender.SendAsync(device, payload, cancellationToken);
                attempted++;
                if (result.Status == NotificationDeliveryStatus.Sent)
                {
                    sent++;
                }
                else
                {
                    failed++;
                    if (PushSendFailureCodes.IsPermanent(result.FailureCode))
                    {
                        // This exact token is permanently dead (see PushSendFailureCodes' own
                        // remarks on which codes qualify) - disable the registration so it stops
                        // being retried forever, on top of recording this one delivery as Failed
                        // below. DisableByIdAsync is idempotent and never throws for a missing/
                        // already-disabled row; a genuine infrastructure error here propagates and
                        // fails this dispatch pass, same as every other store call in this loop.
                        await pushDeviceRegistrationStore.DisableByIdAsync(
                            device.Id, timeProvider.GetUtcNow(), cancellationToken);
                    }
                }

                await notificationDeliveryStore.RecordAttemptAsync(
                    notification.Id,
                    device.Id,
                    result.Status,
                    timeProvider.GetUtcNow(),
                    result.ProviderMessageId,
                    result.FailureCode,
                    cancellationToken);
            }
        }

        return new DispatchDuePushNotificationsResult(candidates.Count, attempted, sent, failed, skipped);
    }
}
