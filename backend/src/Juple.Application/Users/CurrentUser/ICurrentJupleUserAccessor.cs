using Juple.Application.Identity;

namespace Juple.Application.Users.CurrentUser;

public interface ICurrentJupleUserAccessor
{
    Task<CurrentJupleUser> GetRequiredAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default);
}