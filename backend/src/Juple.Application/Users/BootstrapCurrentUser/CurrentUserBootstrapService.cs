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
        // Deliberately checked - and returned on - before validating command below: an already-
        // provisioned user must keep getting a successful (now Plan-carrying) response every time
        // this runs (every app launch/sign-in - see mobile's AuthContext), even if the device
        // happens to report a preferredLocale/timeZoneId that would fail validation. That was
        // already true of the old exists-check-then-early-return shape; only building a new User
        // actually needs valid locale/time zone data.
        var existingPlan = await provisioningStore.FindPlanAsync(externalIdentity, cancellationToken);
        if (existingPlan is { } plan)
        {
            return plan;
        }

        var preferredLocale = NormalizePreferredLocale(command.PreferredLocale);
        var timeZoneId = ValidateTimeZoneId(command.TimeZoneId);
        var createdAtUtc = timeProvider.GetUtcNow();

        return await provisioningStore.CreateAsync(
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