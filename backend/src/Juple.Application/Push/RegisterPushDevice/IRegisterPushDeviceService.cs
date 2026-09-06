namespace Juple.Application.Push.RegisterPushDevice;

public interface IRegisterPushDeviceService
{
    Task<PushDeviceRegistrationDto> RegisterAsync(
        long userId, RegisterPushDeviceCommand command, CancellationToken cancellationToken = default);
}
