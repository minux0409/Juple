using Juple.Infrastructure.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Safety;

public sealed record BlockMembershipReconcileResult(int BlockerCountBefore, int MembershipsBefore, int Removed, int MembershipsAfter);

/// <summary>
/// The rule "blocking the OWNER of a Collection ends my membership in it" for blocks that existed BEFORE the rule did: every membership of a
/// person in a live Collection owned by someone they blocked is removed with the same code path as leaving (<see cref="CollectionCollaborationStore.RemoveCollaboratorAsync"/>:
/// their pending proposals, hearts, favorite and member lock of THAT membership go; the links they added, their own items and every other
/// membership stay). Scoped strictly to (blocker, blocked owner) pairs read from <c>safety.UserBlocks</c>; one transaction per membership;
/// idempotent - a second run finds nothing and changes nothing.
/// </summary>
public static class BlockMembershipReconciler
{
    public static async Task<BlockMembershipReconcileResult> RunAsync(JupleDbContext dbContext, CancellationToken cancellationToken = default)
    {
        IQueryable<(long UserId, long CollectionId)> Pairs() =>
            from member in dbContext.CollectionCollaborators.AsNoTracking()
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null) on member.CollectionId equals collection.Id
            where dbContext.UserBlocks.Any(block => block.BlockerUserId == member.UserId && block.BlockedUserId == collection.UserId)
            select ValueTuple.Create(member.UserId, member.CollectionId);

        var before = await Pairs().ToListAsync(cancellationToken);
        var collaboration = new CollectionCollaborationStore(dbContext);
        var removed = 0;
        foreach (var (userId, collectionId) in before)
        {
            try
            {
                await collaboration.RemoveCollaboratorAsync(collectionId, userId, cancellationToken);
                removed++;
            }
            catch (Juple.Application.Collections.Collaboration.CollectionCollaboratorNotFoundException)
            {
                // Left in the meantime: the state asked for is already there.
            }

            dbContext.ChangeTracker.Clear();
        }

        var after = (await Pairs().ToListAsync(cancellationToken)).Count;
        return new BlockMembershipReconcileResult(before.Select(pair => pair.UserId).Distinct().Count(), before.Count, removed, after);
    }
}
