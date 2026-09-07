using Juple.Domain.Push;

namespace Juple.Application.Push;

/// <summary>
/// Abstracts the actual Push transport (FCM v1 direct for Android today; APNs direct planned for
/// iOS - Azure Notification Hubs is deliberately not used, see docs/architecture.md) behind the one
/// operation the dispatch worker needs. Never throws for an ordinary send failure (a dead token, a
/// transport outage) - those come back as a Failed PushSendResult so the worker can record the
/// attempt and move on; a thrown exception is reserved for a truly unexpected/programmer error.
///
/// Deliberately carries no authentication detail of any kind - the real FCM-backed implementation
/// (FirebaseCloudMessagingSender) authenticates via a Firebase service-account credential read from
/// configuration/secret storage entirely inside that implementation (see
/// DependencyInjection.AddInfrastructure's Firebase:ServiceAccountKeyJson wiring). Nothing in this
/// interface, PushNotificationPayload, or the dispatch worker that calls it needs to change if that
/// credential's storage later moves from a local user-secret/Container Apps secret to Key Vault, or if
/// the transport itself is swapped for something else entirely.
/// </summary>
public interface IPushSender
{
    Task<PushSendResult> SendAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default);
}
