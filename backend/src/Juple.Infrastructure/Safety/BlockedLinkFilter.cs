using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;

namespace Juple.Infrastructure.Safety;

/// <summary>
/// The one rule for a link in a shared Collection when two of its participants block each other: a link added
/// AFTER the block (<c>VisibleSinceUtc &gt;= block.CreatedAtUtc</c>) by the other person is hidden from the viewer - in either
/// direction, whoever blocked. A link that was already there stays visible, nothing is deleted, no membership changes, and
/// removing the block (or never having one) shows everything again. <c>VisibleSinceUtc</c> is the instant the membership became
/// content of the Collection, so a proposal approved after the block counts as new. Authenticated reads only: an anonymous
/// public-link reader has no identity to compare, so the public viewer is deliberately outside this rule.
/// </summary>
public static class BlockedLinkFilter
{
    public static IQueryable<CollectionItem> WhereNotHiddenByBlock(this IQueryable<CollectionItem> memberships, JupleDbContext dbContext, long viewerUserId) =>
        memberships.Where(membership => !dbContext.UserBlocks.Any(block =>
            block.CreatedAtUtc <= membership.VisibleSinceUtc
            && ((block.BlockerUserId == viewerUserId && block.BlockedUserId == membership.AddedByUserId)
                || (block.BlockedUserId == viewerUserId && block.BlockerUserId == membership.AddedByUserId))));

    /// <summary>Same rule as a SQL predicate over an alias <c>m</c> of <c>[collections].[CollectionItems]</c> and a <c>@userId</c> parameter.</summary>
    public const string RawPredicate =
        """
        NOT EXISTS (SELECT 1 FROM [safety].[UserBlocks] AS b
            WHERE b.[CreatedAtUtc] <= m.[VisibleSinceUtc]
                AND ((b.[BlockerUserId] = @userId AND b.[BlockedUserId] = m.[AddedByUserId])
                    OR (b.[BlockedUserId] = @userId AND b.[BlockerUserId] = m.[AddedByUserId])))
        """;
}
