using Juple.Domain.Push;

namespace Juple.Application.Push;

/// <summary>Deliberately excludes PushToken - see PushDeviceRegistration's own remarks on treating it as a secret; never echoed back via any API response.</summary>
public sealed record PushDeviceRegistrationDto(
    long Id,
    PushPlatform Platform,
    string InstallationId,
    string Locale,
    bool IsEnabled,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    DateTimeOffset LastSeenAtUtc);
