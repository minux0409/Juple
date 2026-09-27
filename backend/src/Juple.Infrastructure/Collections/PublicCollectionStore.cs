using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

/// <summary>
/// The anonymous read side, deliberately kept in its own class rather than folded into
/// CollectionStore - every query here is written from scratch, so there is no shared code path that
/// could accidentally leak an authenticated query's private projections (Memo/Category/uploaded
/// images/ItemId - see CollectionStore.GetItemsAsync) into a response an anonymous caller can read.
/// Lock enforcement happens in PublicCollectionService before GetItemsAsync is ever called.
/// </summary>
public sealed class PublicCollectionStore(JupleDbContext dbContext) : IPublicCollectionShareStore
{
    public async Task<PublicShareState?> GetStateAsync(
        string publicId,
        CancellationToken cancellationToken = default)
    {
        return await (
            from share in dbContext.CollectionShares.AsNoTracking()
            where share.PublicId == publicId && share.IsActive
            join collection in dbContext.Collections.AsNoTracking()
                on share.CollectionId equals collection.Id
            where collection.DeletedAtUtc == null
            select new PublicShareState(share.Id, collection.Id, collection.Name, collection.IsLocked, collection.LockVersion, share.Permission)
        ).FirstOrDefaultAsync(cancellationToken);
    }

    public async Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var activeShare = await (
            from share in dbContext.CollectionShares.AsNoTracking()
            where share.PublicId == publicId && share.IsActive
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on share.CollectionId equals collection.Id
            select new { share.CollectionId, OwnerUserId = collection.UserId })
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

        // Only the Owner's own Items and links added through a writable public link are ever
        // published (see IPublicCollectionShareStore) - never a member's - and only their public-safe
        // fields: PreviewImageUrl is the automatic link-preview image, never an uploaded ItemImage;
        // no Memo, no adder identity.
        var pagedQuery =
            from membership in membershipQuery
            join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null)
                on membership.ItemId equals item.Id
            where item.UserId == activeShare.OwnerUserId || membership.AddedViaPublicShare
            orderby membership.SortOrder ascending, membership.ItemId ascending
            select new { item.Title, item.Url, item.PreviewImageUrl, membership.SortOrder, membership.ItemId };

        var page = await pagedQuery.Take(limit + 1).ToListAsync(cancellationToken);

        var hasMore = page.Count > limit;
        var pageRows = hasMore ? page.GetRange(0, limit) : page;

        var items = pageRows.Select(row => new PublicCollectionItemDto(row.Title, row.Url, row.PreviewImageUrl)).ToList();
        var nextCursor = hasMore
            ? new CollectionItemPageCursor(pageRows[^1].SortOrder, pageRows[^1].ItemId)
            : null;

        return new PublicCollectionItemPage(items, nextCursor);
    }
}
