using Juple.Application.Identity;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserBootstrapService
{
    Task BootstrapAsync(
        ExternalIdentityPrincipal externalIdentity,
        BootstrapCurrentUserCommand command,
        CancellationToken cancellationToken = default);
}