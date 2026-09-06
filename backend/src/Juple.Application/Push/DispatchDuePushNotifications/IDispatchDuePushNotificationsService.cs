namespace Juple.Application.Push.DispatchDuePushNotifications;

/// <summary>
/// Intended to be invoked on a schedule (see this feature's own scheduler design notes - an Azure
/// Container Apps Job command, not an in-API BackgroundService, since the Dev Container App scales
/// to zero) rather than per-HTTP-request. No controller calls this today - it is invoked directly
/// from a dedicated entrypoint/tests.
/// </summary>
public interface IDispatchDuePushNotificationsService
{
    Task<DispatchDuePushNotificationsResult> DispatchAsync(CancellationToken cancellationToken = default);
}
