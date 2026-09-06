using Juple.Application.Push;
using Juple.Domain.Push;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The only IPushSender implementation this stage - no Azure Notification Hub exists yet (confirmed
/// via a subscription-wide resource audit; see this feature's own design notes), so there is
/// nothing to actually send through. Every attempt is recorded as a real, honest Failed
/// NotificationDelivery row (never a silent no-op and never a fabricated Sent) so the rest of the
/// dispatch pipeline - candidate selection, idempotency, retry - is fully exercised and tested end
/// to end today. Swap this registration for a real Notification Hub-backed IPushSender once that
/// Hub is approved and provisioned; no other dispatch code needs to change.
/// </summary>
public sealed class NotConfiguredPushSender : IPushSender
{
    public Task<PushSendResult> SendAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default) =>
        Task.FromResult(PushSendResult.Failed("push_transport_not_configured"));
}
