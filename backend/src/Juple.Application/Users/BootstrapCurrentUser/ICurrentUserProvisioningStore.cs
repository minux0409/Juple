using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserProvisioningStore
{
    /// <summary>
    /// When a User already exists for this external identity: best-effort syncs its stored
    /// TimeZoneId to timeZoneId (only writing when it actually differs - device timezone can
    /// legitimately change after first bootstrap, e.g. travel, or the User was created with a
    /// stale/placeholder value) and returns its current Plan. Returns null when no User exists yet
    /// for this identity, signaling the caller to provision one via CreateAsync instead.
    /// </summary>
    Task<UserPlan?> TrySyncTimeZoneAndGetPlanAsync(
        ExternalIdentityPrincipal externalIdentity,
        string timeZoneId,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Provisions a brand-new User (Plan = Free - see User's own remarks), its default Category
    /// seed, and links externalIdentity - all in one transaction. Callers must already know
    /// externalIdentity is not yet bootstrapped (see TrySyncTimeZoneAndGetPlanAsync) - this always
    /// attempts an insert. If a concurrent call already won the race for the same externalIdentity,
    /// returns that other call's resulting Plan instead of throwing (see ExternalIdentityRaceRecovery).
    /// </summary>
    Task<UserPlan> CreateAsync(
        CurrentUserBootstrapData data,
        CancellationToken cancellationToken = default);
}
