using System.Globalization;
using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed class CurrentUserBootstrapService(
    ICurrentUserProvisioningStore provisioningStore,
    TimeProvider timeProvider) : ICurrentUserBootstrapService
{
    private const int PreferredLocaleMaxLength = 35;
    private const int TimeZoneIdMaxLength = 100;

    public async Task<UserPlan> BootstrapAsync(
        ExternalIdentityPrincipal externalIdentity,
        BootstrapCurrentUserCommand command,
        CancellationToken cancellationToken = default)
    {
        // timeZoneId is validated unconditionally, before the existing-identity check below -
        // unlike preferredLocale, it's needed either way: to sync an already-provisioned User's
        // timezone (device timezone can legitimately change after first bootstrap - travel, or a
        // stale/placeholder initial value), or to create a brand-new one.
        var timeZoneId = ValidateTimeZoneId(command.TimeZoneId);
        var utcNow = timeProvider.GetUtcNow();

        // Deliberately checked - and returned on - before validating preferredLocale below: an
        // already-provisioned user must keep getting a successful (Plan-carrying) response every
        // time this runs (every app launch/sign-in - see mobile's AuthContext), even if the device
        // happens to report a preferredLocale that would fail validation - only building a new
        // User actually needs a valid locale.
        var existingPlan = await provisioningStore.TrySyncTimeZoneAndGetPlanAsync(
            externalIdentity, timeZoneId, utcNow, cancellationToken);
        if (existingPlan is { } plan)
        {
            return plan;
        }

        var preferredLocale = NormalizePreferredLocale(command.PreferredLocale);

        return await provisioningStore.CreateAsync(
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
