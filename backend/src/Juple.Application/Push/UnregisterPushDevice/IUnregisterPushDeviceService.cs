namespace Juple.Application.Push.UnregisterPushDevice;

public interface IUnregisterPushDeviceService
{
    Task UnregisterAsync(long userId, string installationId, CancellationToken cancellationToken = default);
}
