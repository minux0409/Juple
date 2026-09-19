using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserBootstrapService
{
    /// <summary>Returns the current user's Plan - the already-provisioned one when externalIdentity was bootstrapped before, or the newly-provisioned Free default otherwise.</summary>
    Task<UserPlan> BootstrapAsync(
        ExternalIdentityPrincipal externalIdentity,
        BootstrapCurrentUserCommand command,
        CancellationToken cancellationToken = default);
}
