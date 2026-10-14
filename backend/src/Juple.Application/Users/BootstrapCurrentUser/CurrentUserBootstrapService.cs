using System.Globalization;
using Juple.Application.Billing;
using Juple.Application.Users.DeleteAccount;
using Juple.Application.Collections.Locking;
using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public sealed class CurrentUserBootstrapService(
    ICurrentUserProvisioningStore provisioningStore,
    IEntitlementService entitlementService,
    TimeProvider timeProvider,
    EntraAccountDeletionOptions entraOptions,
    IEntraIdentityDeletionService entraDeletionService,
    IEntraIdentityDirectory entraDirectory,
    ITrialIdentityHasher trialIdentityHasher,
    ITrialEmailLedger trialEmailLedger) : ICurrentUserBootstrapService
{
    private const int PreferredLocaleMaxLength = 35;
    private const int TimeZoneIdMaxLength = 100;

    public async Task<CurrentUserBootstrapResult> BootstrapAsync(
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
        // A successful sync stores exactly this validated value (a failed write fails the bootstrap), so it is the
        // canonical zone from here on.
        if (existingPlan is { } plan)
        {
            return new CurrentUserBootstrapResult(
                plan,
                timeZoneId,
                await entitlementService.GetForIdentityAsync(externalIdentity, cancellationToken),
                await entitlementService.GetStoreSubscriptionForIdentityAsync(externalIdentity, cancellationToken));
        }

        var preferredLocale = NormalizePreferredLocale(command.PreferredLocale);

        // No Juple account exists for this identity. Creating one is an explicit act - a person signing up or signing in
        // again - never a side effect of a stale session. The Entra identity outlives account deletion (Juple does not delete
        // it), so a refresh token or browser SSO session that still works would otherwise re-create the account silently,
        // e.g. from a second device or a restored session right after the account was deleted. Account creation therefore
        // needs a sign-in that happened just now (the same server-verified auth_time rule as account deletion). Fail closed:
        // a token with no auth_time, an unreadable one, a stale one or one from the future all refuse creation (DEV and PROD
        // API registrations emit auth_time). The client answers the 403 by asking for the credentials again (prompt=login).
        // An EXISTING account returned above is never gated.
        RecentAuthentication.Require(command.AuthenticatedAtUtc, utcNow);

        // The account this identity used to have is being deleted and its sign-in account is not gone yet: the old password must not
        // yield a fresh account. (A pending deletion is finished here first when it can be - see IsStillPendingAsync.)
        if (entraOptions.Enabled && await entraDeletionService.IsStillPendingAsync(externalIdentity, cancellationToken))
        {
            throw new AccountDeletionPendingException();
        }

        var createdPlan = await provisioningStore.CreateAsync(
            new CurrentUserBootstrapData(
                externalIdentity,
                preferredLocale,
                timeZoneId,
                DefaultCurrencyCode: null,
                utcNow),
            cancellationToken);
        await InheritTrialWindowAsync(externalIdentity, cancellationToken);
        return new CurrentUserBootstrapResult(
            createdPlan,
            timeZoneId,
            await entitlementService.GetForIdentityAsync(externalIdentity, cancellationToken),
            await entitlementService.GetStoreSubscriptionForIdentityAsync(externalIdentity, cancellationToken));
    }

    /// <summary>
    /// A person who deleted their account and signs up again has a NEW Entra object id but the same email: the trial window kept under
    /// the keyed email hash is given back, never a fresh 30 days. Best effort - a directory outage must not block a sign-up.
    /// </summary>
    private async Task InheritTrialWindowAsync(ExternalIdentityPrincipal externalIdentity, CancellationToken cancellationToken)
    {
        if (!entraOptions.Enabled)
        {
            return;
        }

        try
        {
            var emailHash = trialIdentityHasher.HashEmail(await entraDirectory.GetSignInEmailAsync(externalIdentity, cancellationToken));
            if (emailHash is not null)
            {
                await trialEmailLedger.InheritAsync(externalIdentity, emailHash, cancellationToken);
            }
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            // Left without inheritance; the account still gets a window by the normal rules.
        }
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
