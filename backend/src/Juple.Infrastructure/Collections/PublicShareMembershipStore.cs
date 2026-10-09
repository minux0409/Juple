using Juple.Application.Collections.Public;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// "Is this signed-in user already in the Collection this public link points to?" - two indexed lookups (the share, then the
/// member row), never a member list. Written separately from the anonymous PublicCollectionStore so the public read path stays free
/// of any per-user, internal-id-carrying query.
/// </summary>
public sealed class PublicShareMembershipStore(JupleDbContext dbContext) : IPublicShareMembershipStore
{
    public async Task<PublicShareMembershipDto?> GetAsync(string publicId, long userId, CancellationToken cancellationToken = default)
    {
        var target = await (
            from share in dbContext.CollectionShares.AsNoTracking()
            where share.PublicId == publicId && share.IsActive
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on share.CollectionId equals collection.Id
            select new { collection.Id, OwnerUserId = collection.UserId, share.IsPublic })
            .FirstOrDefaultAsync(cancellationToken);
        if (target is null)
        {
            return null;
        }

        if (target.OwnerUserId == userId)
        {
            return new PublicShareMembershipDto(true, target.Id, "owner");
        }

        var role = await dbContext.CollectionCollaborators.AsNoTracking()
            .Where(collaborator => collaborator.CollectionId == target.Id && collaborator.UserId == userId)
            .Select(collaborator => (CollectionCollaboratorRole?)collaborator.Role)
            .FirstOrDefaultAsync(cancellationToken);
        return role is { } found
            ? new PublicShareMembershipDto(true, target.Id, found.ToString().ToLowerInvariant())
            : new PublicShareMembershipDto(
                false, null, null,
                target.IsPublic,
                !target.IsPublic
                    && await dbContext.CollectionJoinRequests.AsNoTracking().AnyAsync(
                        request => request.CollectionId == target.Id && request.RequesterUserId == userId && request.Status == CollectionJoinRequestStatus.Pending,
                        cancellationToken));
    }
}
