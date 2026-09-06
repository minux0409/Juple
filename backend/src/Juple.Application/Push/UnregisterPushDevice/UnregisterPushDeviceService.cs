namespace Juple.Application.Push.UnregisterPushDevice;

/// <summary>Called on logout - disables (never deletes) the registration, mirroring RepeatPurchase's own Disable-not-Delete lifecycle choice, so a later re-login/re-registration is a simple Reregister rather than a fresh row.</summary>
public sealed class UnregisterPushDeviceService(IPushDeviceRegistrationStore pushDeviceRegistrationStore, TimeProvider timeProvider)
    : IUnregisterPushDeviceService
{
    public Task UnregisterAsync(long userId, string installationId, CancellationToken cancellationToken = default) =>
        pushDeviceRegistrationStore.DisableAsync(userId, installationId, timeProvider.GetUtcNow(), cancellationToken);
}
