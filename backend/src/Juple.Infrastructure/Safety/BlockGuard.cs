using Juple.Application.Safety;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Safety;

/// <summary>
/// The block check for the stores that write an interaction between two people (comment, heart, reaction, invitation, join). It reads the
/// same <c>safety.UserBlocks</c> table as <see cref="UserBlockPolicy"/> - one rule, one table - inside the write's own database context,
/// so the check and the write see the same data. Throws <see cref="UserBlockedException"/> when either person blocked the other.
/// </summary>
public static class BlockGuard
{
    public static async Task EnsureNotBlockedAsync(JupleDbContext dbContext, long userId, long? otherUserId, CancellationToken cancellationToken)
    {
        if (otherUserId is not { } other || other == userId)
        {
            return;
        }

        var blockers = await dbContext.UserBlocks.AsNoTracking()
            .Where(block => (block.BlockerUserId == userId && block.BlockedUserId == other) || (block.BlockerUserId == other && block.BlockedUserId == userId))
            .Select(block => block.BlockerUserId)
            .ToListAsync(cancellationToken);
        if (blockers.Count > 0)
        {
            throw new UserBlockedException(blockedByCaller: blockers.Contains(userId));
        }
    }
}
