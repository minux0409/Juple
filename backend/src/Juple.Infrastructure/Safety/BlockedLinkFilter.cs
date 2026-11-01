using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;

namespace Juple.Infrastructure.Safety;

/// <summary>
/// The one rule for a link in a shared Collection when two of its participants block each other: a link ADDED BY the other person is
/// hidden from the viewer, whenever it was added - in either direction, whoever blocked whom. "Added by" is
/// <c>CollectionItem.AddedByUserId</c>: the person who put the link into the Collection (an approved proposal: the person who proposed it).
/// Nothing is deleted and no membership changes; links of a third person follow the normal access rules, and removing the block shows
/// everything again. Authenticated reads only: an anonymous public-link reader has no identity to compare, so the public viewer is
/// deliberately outside this rule.
/// </summary>
public static class BlockedLinkFilter
{
    public static IQueryable<CollectionItem> WhereNotHiddenByBlock(this IQueryable<CollectionItem> memberships, JupleDbContext dbContext, long viewerUserId) =>
        memberships.Where(membership => !dbContext.UserBlocks.Any(block =>
            ((block.BlockerUserId == viewerUserId && block.BlockedUserId == membership.AddedByUserId)
                || (block.BlockedUserId == viewerUserId && block.BlockerUserId == membership.AddedByUserId))));

    /// <summary>Same rule as a SQL predicate over an alias <c>m</c> of <c>[collections].[CollectionItems]</c> and a <c>@userId</c> parameter.</summary>
    public const string RawPredicate =
        """
        NOT EXISTS (SELECT 1 FROM [safety].[UserBlocks] AS b
            WHERE ((b.[BlockerUserId] = @userId AND b.[BlockedUserId] = m.[AddedByUserId])
                    OR (b.[BlockedUserId] = @userId AND b.[BlockerUserId] = m.[AddedByUserId])))
        """;
}
