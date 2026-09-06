namespace Juple.Application.Push.RegisterPushDevice;

public sealed class RegisterPushDeviceService(IPushDeviceRegistrationStore pushDeviceRegistrationStore, TimeProvider timeProvider)
    : IRegisterPushDeviceService
{
    private const int InstallationIdMaxLength = 100;
    private const int PushTokenMaxLength = 1024;
    private const int LocaleMaxLength = 35;
    private const string DefaultLocale = "en";

    public Task<PushDeviceRegistrationDto> RegisterAsync(
        long userId, RegisterPushDeviceCommand command, CancellationToken cancellationToken = default)
    {
        var installationId = command.InstallationId?.Trim();
        if (string.IsNullOrEmpty(installationId))
        {
            throw new InvalidPushDeviceRegistrationException("installationId", "installationId is required.");
        }

        if (installationId.Length > InstallationIdMaxLength)
        {
            throw new InvalidPushDeviceRegistrationException(
                "installationId", $"installationId must be at most {InstallationIdMaxLength} characters.");
        }

        var pushToken = command.PushToken?.Trim();
        if (string.IsNullOrEmpty(pushToken))
        {
            throw new InvalidPushDeviceRegistrationException("pushToken", "pushToken is required.");
        }

        if (pushToken.Length > PushTokenMaxLength)
        {
            throw new InvalidPushDeviceRegistrationException(
                "pushToken", $"pushToken must be at most {PushTokenMaxLength} characters.");
        }

        // A malformed/oversized locale must never fail registration (Push would simply stop working
        // for this device) - it silently falls back to English, the same safe default used when
        // Mobile has not resolved a language yet (see i18n/index.ts's own "system" fallback).
        var locale = command.Locale?.Trim();
        if (string.IsNullOrEmpty(locale) || locale.Length > LocaleMaxLength)
        {
            locale = DefaultLocale;
        }

        return pushDeviceRegistrationStore.RegisterAsync(
            userId, command.Platform, installationId, pushToken, locale, timeProvider.GetUtcNow(), cancellationToken);
    }
}
