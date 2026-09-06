using Juple.Domain.Push;

namespace Juple.Application.Push;

/// <summary>
/// Abstracts the actual Push transport (Azure Notification Hubs, or any future replacement) behind
/// the one operation the dispatch worker needs. Never throws for an ordinary send failure (a dead
/// token, a transport outage) - those come back as a Failed PushSendResult so the worker can record
/// the attempt and move on; a thrown exception is reserved for a truly unexpected/programmer error.
///
/// Deliberately carries no authentication detail of any kind - a real Notification Hubs-backed
/// implementation authenticates via a Hub-scoped SAS connection string (Azure Notification Hubs'
/// data-plane SDK supports only SAS access-policy auth, not Managed Identity/Entra ID; see this
/// feature's own design notes, confirmed against Microsoft's own Notification Hubs security-model
/// docs), read from configuration/secret storage entirely inside that implementation. Nothing in
/// this interface, PushNotificationPayload, or the dispatch worker that calls it needs to change
/// if that connection string's storage later moves from a Container Apps secret to Key Vault, or if
/// the transport itself is swapped for something else entirely.
/// </summary>
public interface IPushSender
{
    Task<PushSendResult> SendAsync(
        PushDeviceRegistration device, PushNotificationPayload payload, CancellationToken cancellationToken = default);
}
