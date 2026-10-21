using Juple.Domain.Push;

namespace Juple.Application.Push.RegisterPushDevice;

public sealed class RegisterPushDeviceService(IPushDeviceRegistrationStore pushDeviceRegistrationStore, TimeProvider timeProvider)
    : IRegisterPushDeviceService
{
    private const int InstallationIdMaxLength = 100;
    private const int PushTokenMaxLength = 1024;
    private const int LocaleMaxLength = 35;
    private const string DefaultLocale = "en";
    private const int ApnsTokenMinLength = 64;
    private const int ApnsTokenMaxLength = 200;

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

        if (command.Platform == PushPlatform.Ios)
        {
            // An APNs device token is the hex form of the bytes iOS hands the app (32 bytes today; Apple allows up to 100). Anything else
            // is not an APNs token (an FCM token sent by mistake, for instance) and could never be delivered.
            if (pushToken.Length is < ApnsTokenMinLength or > ApnsTokenMaxLength || pushToken.Length % 2 != 0 || !pushToken.All(char.IsAsciiHexDigit))
            {
                throw new InvalidPushDeviceRegistrationException(
                    "pushToken", "An iOS pushToken must be the APNs device token as hexadecimal text.");
            }

            pushToken = pushToken.ToLowerInvariant();
        }
        else if (command.ApnsEnvironment is not null)
        {
            throw new InvalidPushDeviceRegistrationException("apnsEnvironment", "apnsEnvironment applies to iOS registrations only.");
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
            userId,
            command.Platform,
            installationId,
            pushToken,
            locale,
            timeProvider.GetUtcNow(),
            command.Platform == PushPlatform.Ios ? command.ApnsEnvironment ?? ApnsEnvironment.Production : null,
            cancellationToken);
    }
}
