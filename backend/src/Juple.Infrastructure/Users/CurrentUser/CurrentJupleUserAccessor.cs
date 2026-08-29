using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Domain.Identity;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Users.CurrentUser;

public sealed class CurrentJupleUserAccessor(JupleDbContext dbContext) : ICurrentJupleUserAccessor
{
    public async Task<CurrentJupleUser> GetRequiredAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default)
    {
        var currentUser = await (
            from identity in dbContext.Set<ExternalIdentity>()
            join user in dbContext.Users on identity.UserId equals user.Id
            where identity.TenantId == externalIdentity.TenantId
                && identity.ObjectId == externalIdentity.ObjectId
            select new CurrentJupleUser(user.Id, user.TimeZoneId))
            .SingleOrDefaultAsync(cancellationToken);

        return currentUser ?? throw new CurrentJupleUserNotFoundException();
    }
}