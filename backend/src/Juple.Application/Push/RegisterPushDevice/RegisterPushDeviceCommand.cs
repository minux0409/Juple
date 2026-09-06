using Juple.Domain.Push;

namespace Juple.Application.Push.RegisterPushDevice;

public sealed record RegisterPushDeviceCommand(
    PushPlatform Platform, string? InstallationId, string? PushToken, string? Locale);
