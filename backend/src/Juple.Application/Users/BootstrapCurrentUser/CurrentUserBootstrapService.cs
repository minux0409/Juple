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
        if (await provisioningStore.ExternalIdentityExistsAsync(externalIdentity, cancellationToken))
        {
            return;
        }

        var preferredLocale = NormalizePreferredLocale(command.PreferredLocale);
        var timeZoneId = ValidateTimeZoneId(command.TimeZoneId);
        var createdAtUtc = timeProvider.GetUtcNow();

        await provisioningStore.CreateOrGetAsync(
            new CurrentUserBootstrapData(
                externalIdentity,
                preferredLocale,
                timeZoneId,
                DefaultCurrencyCode: null,
                createdAtUtc),
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