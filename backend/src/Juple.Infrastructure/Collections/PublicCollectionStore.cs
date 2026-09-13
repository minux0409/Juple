using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// The anonymous read side, deliberately kept in its own class rather than folded into
/// CollectionStore - every query here is written from scratch with no UserId join anywhere, so
/// there is no shared code path that could accidentally leak an authenticated query's private
/// projections (Memo/Category/RepresentativeImage/ItemId - see CollectionStore.GetItemsAsync) into
/// a response an anonymous caller can read.
/// </summary>
public sealed class PublicCollectionStore(JupleDbContext dbContext) : IPublicCollectionShareStore
{
    public async Task<PublicCollectionDto?> GetCollectionAsync(
        string publicId,
        CancellationToken cancellationToken = default)
    {
        return await (
            from share in dbContext.CollectionShares.AsNoTracking()
            where share.PublicId == publicId && share.IsActive
            join collection in dbContext.Collections.AsNoTracking()
                on share.CollectionId equals collection.Id
            select new PublicCollectionDto(collection.Name)
        ).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var activeShare = await dbContext.CollectionShares
            .AsNoTracking()
            .Where(share => share.PublicId == publicId && share.IsActive)
            .Select(share => new { share.CollectionId })
            .FirstOrDefaultAsync(cancellationToken);
        if (activeShare is null)
        {
            return null;
        }

        var membershipQuery = dbContext.CollectionItems
            .AsNoTracking()
            .Where(membership => membership.CollectionId == activeShare.CollectionId);

        if (cursor is not null)
        {
            membershipQuery = membershipQuery.Where(membership =>
                membership.SortOrder > cursor.SortOrder
                || (membership.SortOrder == cursor.SortOrder && membership.ItemId > cursor.ItemId));
        }

        var pagedQuery =
            from membership in membershipQuery
            join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
            orderby membership.SortOrder ascending, membership.ItemId ascending
            select new { item.Title, item.Url, membership.SortOrder, membership.ItemId };

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var items = pageRows.Select(row => new PublicCollectionItemDto(row.Title, row.Url)).ToList();
        var nextCursor = hasMore
            ? new CollectionItemPageCursor(pageRows[^1].SortOrder, pageRows[^1].ItemId)
            : null;

        return new PublicCollectionItemPage(items, nextCursor);
    }
}
