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
        var currentUser = await Query(dbContext, externalIdentity.TenantId, externalIdentity.ObjectId)
            .SingleOrDefaultAsync(cancellationToken);

        return currentUser ?? throw new CurrentJupleUserNotFoundException();
    }

    /// <summary>The one query every authenticated request runs first. Shared with the start-up query warm-up (translation only).</summary>
    internal static IQueryable<CurrentJupleUser> Query(JupleDbContext dbContext, Guid tenantId, Guid objectId) =>
        from identity in dbContext.Set<ExternalIdentity>()
        join user in dbContext.Users on identity.UserId equals user.Id
        where identity.TenantId == tenantId
            && identity.ObjectId == objectId
        select new CurrentJupleUser(user.Id, user.TimeZoneId, user.Plan);
}