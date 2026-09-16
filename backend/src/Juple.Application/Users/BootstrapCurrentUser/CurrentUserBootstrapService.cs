using System.Globalization;
using Juple.Application.Identity;

namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed class CurrentUserBootstrapService(
    ICurrentUserProvisioningStore provisioningStore,
    TimeProvider timeProvider) : ICurrentUserBootstrapService
{
    private const int PreferredLocaleMaxLength = 35;
    private const int TimeZoneIdMaxLength = 100;

    public async Task BootstrapAsync(
        ExternalIdentityPrincipal externalIdentity,
        BootstrapCurrentUserCommand command,
        CancellationToken cancellationToken = default)
    {
        var timeZoneId = ValidateTimeZoneId(command.TimeZoneId);
        var utcNow = timeProvider.GetUtcNow();

        // Device timezone can legitimately change after a User already exists (travel, or the
        // device simply had a wrong/default zone at first bootstrap) - re-sync it here on every
        // bootstrap call instead of only setting it once at creation. Best-effort: only writes
        // when the value actually differs, and never touches PreferredLocale for an existing User.
        if (await provisioningStore.TrySyncTimeZoneIfExistingAsync(
                externalIdentity, timeZoneId, utcNow, cancellationToken))
        {
            return;
        }

        var preferredLocale = NormalizePreferredLocale(command.PreferredLocale);

        await provisioningStore.CreateOrGetAsync(
            new CurrentUserBootstrapData(
                externalIdentity,
                preferredLocale,
                timeZoneId,
                DefaultCurrencyCode: null,
                utcNow),
            cancellationToken);
    }

    private static string NormalizePreferredLocale(string? preferredLocale)
    {
        if (string.IsNullOrWhiteSpace(preferredLocale)
            || preferredLocale.Length > PreferredLocaleMaxLength)
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "preferredLocale",
                "A valid preferred locale is required.");
        }

        try
        {
            return CultureInfo.GetCultureInfo(preferredLocale.Trim()).Name;
        }
        catch (CultureNotFoundException)
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "preferredLocale",
                "A valid preferred locale is required.");
        }
    }

    private static string ValidateTimeZoneId(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)
            || timeZoneId.Length > TimeZoneIdMaxLength)
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "timeZoneId",
                "A valid IANA time zone ID is required.");
        }

        var normalizedTimeZoneId = timeZoneId.Trim();
        if (!TimeZoneInfo.TryConvertIanaIdToWindowsId(normalizedTimeZoneId, out _))
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "timeZoneId",
                "A valid IANA time zone ID is required.");
        }

        try
        {
            _ = TimeZoneInfo.FindSystemTimeZoneById(normalizedTimeZoneId);
            return normalizedTimeZoneId;
        }
        catch (TimeZoneNotFoundException)
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "timeZoneId",
                "A valid IANA time zone ID is required.");
        }
        catch (InvalidTimeZoneException)
        {
            throw new InvalidCurrentUserBootstrapRequestException(
                "timeZoneId",
                "A valid IANA time zone ID is required.");
        }
    }
}