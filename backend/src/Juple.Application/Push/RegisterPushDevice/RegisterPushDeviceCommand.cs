using Juple.Domain.Push;

namespace Juple.Application.Push.RegisterPushDevice;

/// <param name="ApnsEnvironment">iOS only: the APNs gateway the token belongs to (null = production). Must be null for Android.</param>
public sealed record RegisterPushDeviceCommand(
    PushPlatform Platform, string? InstallationId, string? PushToken, string? Locale, ApnsEnvironment? ApnsEnvironment = null);
