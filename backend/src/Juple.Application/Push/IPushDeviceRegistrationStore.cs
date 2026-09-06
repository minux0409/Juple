using Juple.Domain.Push;

namespace Juple.Application.Push;

public interface IPushDeviceRegistrationStore
{
    /// <summary>
    /// Idempotent upsert keyed by (platform, installationId), globally - never scoped by userId (see
    /// PushDeviceRegistration's own remarks and UX_PushDeviceRegistrations_Platform_InstallationId).
    /// Registering the same installation again as the same user is a Reregister (token/locale
    /// refresh, re-enable). Registering it as a *different* user is an ownership transfer (see
    /// PushDeviceRegistration.ReassignOwner) - an account switch on that device - so it never keeps
    /// receiving Push for a user who no longer controls it. Safe under concurrent registration calls
    /// for the exact same installation: the DB's unique constraint, not an application-level check,
    /// is what guarantees at most one row (and therefore one owner) ever exists for it.
    /// </summary>
    Task<PushDeviceRegistrationDto> RegisterAsync(
        long userId,
        PushPlatform platform,
        string installationId,
        string pushToken,
        string locale,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default);

    /// <summary>Throws PushDeviceRegistrationNotFoundException for a missing/other-user installationId. Idempotent - disabling an already-disabled registration succeeds without changing it.</summary>
    Task DisableAsync(
        long userId, string installationId, DateTimeOffset updatedAtUtc, CancellationToken cancellationToken = default);

    /// <summary>All currently-enabled registrations for userId - the dispatch worker's device fan-out list.</summary>
    Task<IReadOnlyList<PushDeviceRegistration>> ListEnabledAsync(
        long userId, CancellationToken cancellationToken = default);
}
