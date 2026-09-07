using Juple.Application.Push;
using Juple.Domain.Push;

namespace Juple.Infrastructure.Push;

/// <summary>
/// The IPushSender used whenever no Firebase service-account credential is configured (see
/// DependencyInjection.AddInfrastructure's own Firebase:ServiceAccountKeyJson branch) - an
/// intentional, explicit choice for an environment that has no Push transport configured at all,
/// never a silent degrade from a real one. Every attempt is recorded as a real, honest Failed
/// NotificationDelivery row (never a silent no-op and never a fabricated Sent) so the rest of the
/// dispatch pipeline - candidate selection, idempotency, retry - is fully exercised and tested end
/// to end even with no transport configured. A malformed/invalid credential (as opposed to a wholly
/// absent one) is a startup failure, not a silent fall-through to this class - see
/// DependencyInjection's own remarks.
/// </summary>
public sealed class NotConfiguredPushSender : IPushSender
{
    public Task<PushSendResult> SendAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default) =>
        Task.FromResult(PushSendResult.Failed(PushSendFailureCodes.TransportNotConfigured));
}
