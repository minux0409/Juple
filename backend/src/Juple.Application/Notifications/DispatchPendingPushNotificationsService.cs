using System.Globalization;
using Juple.Application.Push;
using Juple.Domain.Notifications;

namespace Juple.Application.Notifications;

/// <summary>
/// One pass of the push-dispatch Job - since the Service Bus fast path, the RECOVERY sweep, not the
/// normal way a Push goes out. It finishes what the fast path did not: outbox events whose signal was
/// lost (Service Bus down, the API stopped right after its commit) or whose processor died (lease
/// expired), and notifications still undispatched after the grace period (a lost deliveries message,
/// a transient provider failure). It does so with the very same processors the worker uses, so the
/// event lease and the per-(notification, device) claim keep it from duplicating the worker's work.
/// It needs no Service Bus at all - with the fast path unconfigured or unavailable, it alone delivers
/// everything, as before. It also expires stale notifications and trims old processed events.
/// </summary>
public sealed class DispatchPendingPushNotificationsService(
    INotificationEventStore eventStore,
    INotificationEventProcessor eventProcessor,
    IPushDispatchStore dispatchStore,
    IPushDeliveryProcessor deliveryProcessor,
    TimeProvider timeProvider,
    NotificationPipelineOptions options) : IDispatchPendingPushNotificationsService
{
    public async Task<DispatchPendingPushNotificationsResult> RunOnceAsync(CancellationToken cancellationToken = default)
    {
        var nowUtc = timeProvider.GetUtcNow();
        var createdBefore = nowUtc - TimeSpan.FromSeconds(Math.Max(0, options.RecoveryGraceSeconds));

        // 1. Outbox events the fast path has not finished: materialized and delivered here, directly.
        var recovered = 0;
        var delivered = PushDeliveryResult.Empty;
        var retriesScheduled = 0;
        foreach (var eventId in await eventStore.ListRecoverableAsync(Math.Max(1, options.RecoveryEventLimit), createdBefore, nowUtc, cancellationToken))
        {
            try
            {
                var outcome = await eventProcessor.ProcessAsync(eventId, deliverInline: true, cancellationToken);
                if (outcome.Processed)
                {
                    recovered++;
                    delivered = delivered.Add(outcome.Delivered ?? PushDeliveryResult.Empty);
                }
            }
            catch (NotificationEventRetryScheduledException)
            {
                // Its retry is scheduled in SQL; one failing event never stops the rest of the run.
                retriesScheduled++;
            }
        }

        // 2. Notifications still undispatched after the grace period.
        var pending = await dispatchStore.ListPendingAsync(Math.Max(1, options.RecoveryNotificationLimit), createdBefore, cancellationToken);
        delivered = delivered.Add(await deliveryProcessor.DeliverLoadedAsync(pending, cancellationToken));

        // 3. Processed events are kept a while for diagnosis, then removed in a bounded batch.
        await eventStore.DeleteCompletedBeforeAsync(nowUtc - TimeSpan.FromDays(Math.Max(1, options.ProcessedEventRetentionDays)), 1000, cancellationToken);

        return new DispatchPendingPushNotificationsResult(
            delivered.Pending, delivered.Sent, delivered.Failed, delivered.Skipped, delivered.Expired, recovered, retriesScheduled);
    }

    public static PushNotificationPayload BuildPayload(Notification notification, PushDispatchContext context, string locale)
    {
        var data = new Dictionary<string, string>();
        var opensPublicLink = notification.Type == NotificationType.CollectionLinkShared
            || (notification.Type is NotificationType.CollectionLinkSubmissionApproved or NotificationType.CollectionLinkSubmissionRejected
                && !context.RecipientBelongs);
        if (opensPublicLink)
        {
            // The recipient is not a member: only the public link's own id (what the public page
            // opens with, and only while it is on) - never the internal Collection id.
            if (context.PublicShareId is { } publicId)
            {
                data["publicId"] = publicId;
            }
        }
        else if (notification.CollectionId is { } collectionId)
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
