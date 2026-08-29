using Juple.Application.Identity;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserProvisioningStore
{
    Task<bool> ExternalIdentityExistsAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default);

    Task CreateOrGetAsync(
        CurrentUserBootstrapData data,
        CancellationToken cancellationToken = default);
}