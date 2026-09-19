using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserProvisioningStore
{
    /// <summary>Null when externalIdentity has never been bootstrapped before.</summary>
    Task<UserPlan?> FindPlanAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Provisions a brand-new User (Plan = Free - see User's own remarks), its default Category
    /// seed, and links externalIdentity - all in one transaction, exactly like the previous
    /// CreateOrGetAsync. Callers must already know externalIdentity is not yet bootstrapped (see
    /// FindPlanAsync) - this always attempts an insert. If a concurrent call already won the race
    /// for the same externalIdentity, returns that other call's resulting Plan instead of throwing
    /// (see ExternalIdentityRaceRecovery).
    /// </summary>
    Task<UserPlan> CreateAsync(
        CurrentUserBootstrapData data,
        CancellationToken cancellationToken = default);
}
