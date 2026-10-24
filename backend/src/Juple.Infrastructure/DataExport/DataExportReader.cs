using System.Runtime.CompilerServices;
using System.Text.Json;
using Juple.Application.DataExport;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.DataExport;

/// <summary>
/// The export's read side. Every query is filtered by the person's own UserId; Collections are read only when the person owns them or
/// still belongs to them. Streams page by keyset and materialize one page at a time, so no database reader stays open while the
/// (possibly slow) download is written, and memory stays bounded by the page size.
/// </summary>
public sealed class DataExportReader(JupleDbContext dbContext) : IDataExportReader
{
    private const int PageSize = 500;

    public async Task<DataExportAccount?> GetAccountAsync(long userId, CancellationToken cancellationToken = default) =>
        await dbContext.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new DataExportAccount(
                user.PublicCode,
                user.DisplayName,
                user.PreferredLocale,
                user.TimeZoneId,
                user.DefaultCurrencyCode,
                user.CreatedAtUtc,
                user.ProfileImageBlobName))
            .SingleOrDefaultAsync(cancellationToken);

    public async Task<DataExportCounts> GetCountsAsync(long userId, CancellationToken cancellationToken = default)
    {
        var links = await dbContext.Items.AsNoTracking().CountAsync(item => item.UserId == userId, cancellationToken);
        var linksInTrash = await dbContext.Items.AsNoTracking().CountAsync(item => item.UserId == userId && item.DeletedAtUtc != null, cancellationToken);
        var owned = await dbContext.Collections.AsNoTracking().CountAsync(collection => collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        var memberships = await MembershipsQuery(userId).CountAsync(cancellationToken);
        var comments = await dbContext.CollectionItemComments.AsNoTracking().CountAsync(comment => comment.UserId == userId && comment.DeletedAtUtc == null, cancellationToken);
        var purchases = await dbContext.Purchases.AsNoTracking().CountAsync(purchase => purchase.UserId == userId, cancellationToken);
        var repeatPurchases = await dbContext.RepeatPurchases.AsNoTracking().CountAsync(repeat => repeat.UserId == userId, cancellationToken);
        var collectionEntries = await (
            from membership in dbContext.CollectionItems.AsNoTracking()
            join collection in dbContext.Collections.AsNoTracking() on membership.CollectionId equals collection.Id
            join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
            where collection.DeletedAtUtc == null && (collection.UserId == userId
                || (item.UserId == userId && dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)))
            select membership.Id).LongCountAsync(cancellationToken);
        var photos = await OwnImagesQuery(userId)
            .GroupBy(_ => 1)
            .Select(group => new { Count = group.Count(), Bytes = group.Sum(image => image.ByteLength) })
            .SingleOrDefaultAsync(cancellationToken);
        return new DataExportCounts(links, linksInTrash, owned, memberships, comments, purchases, repeatPurchases, photos?.Count ?? 0, photos?.Bytes ?? 0, collectionEntries);
    }

    public async IAsyncEnumerable<DataExportItem> ReadItemsAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long afterId = 0;
        while (true)
        {
            var page = await dbContext.Items
                .AsNoTracking()
                .Where(item => item.UserId == userId && item.Id > afterId)
                .OrderBy(item => item.Id)
                .Take(PageSize)
                .Select(item => new { item.Id, item.Url, item.Title, item.Memo, item.PreviewImageUrl, item.SavedAtUtc, item.DeletedAtUtc })
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            var ids = page.Select(item => item.Id).ToList();
            var photos = (await dbContext.ItemImages
                    .AsNoTracking()
                    .Where(image => ids.Contains(image.ItemId))
                    .Select(image => new { image.ItemId, image.Id, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc })
                    .ToListAsync(cancellationToken))
                .GroupBy(image => image.ItemId)
                .ToDictionary(
                    group => group.Key,
                    group => (IReadOnlyList<DataExportItemPhoto>)group
                        .OrderBy(image => image.SortOrder)
                        .ThenBy(image => image.Id)
                        .Select(image => new DataExportItemPhoto(image.Id, image.ContentType, image.ByteLength, image.SortOrder, image.CreatedAtUtc))
                        .ToList());

            // Only Collections the person owns or still belongs to: a Collection they left is someone else's data now.
            var memberships = (await (
                    from membership in dbContext.CollectionItems.AsNoTracking()
                    join collection in dbContext.Collections.AsNoTracking() on membership.CollectionId equals collection.Id
                    where ids.Contains(membership.ItemId)
                        && collection.DeletedAtUtc == null
                        && (collection.UserId == userId
                            || dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId))
                    select new { membership.ItemId, membership.CollectionId, membership.AddedAtUtc })
                    .ToListAsync(cancellationToken))
                .GroupBy(membership => membership.ItemId)
                .ToDictionary(
                    group => group.Key,
                    group => (IReadOnlyList<DataExportItemCollection>)group
                        .OrderBy(membership => membership.CollectionId)
                        .Select(membership => new DataExportItemCollection(membership.CollectionId, membership.AddedAtUtc))
                        .ToList());

            foreach (var item in page)
            {
                yield return new DataExportItem(
                    item.Id,
                    item.Url,
                    item.Title,
                    item.Memo,
                    item.PreviewImageUrl,
                    item.SavedAtUtc,
                    item.DeletedAtUtc,
                    photos.GetValueOrDefault(item.Id) ?? [],
                    memberships.GetValueOrDefault(item.Id) ?? []);
            }

            afterId = page[^1].Id;
        }
    }

    public async Task<IReadOnlyList<DataExportOwnedCollection>> GetOwnedCollectionsAsync(long userId, CancellationToken cancellationToken = default)
    {
        var collections = await dbContext.Collections
            .AsNoTracking()
            .Where(collection => collection.UserId == userId && collection.DeletedAtUtc == null)
            .OrderBy(collection => collection.Id)
            .Select(collection => new
            {
                collection.Id,
                collection.Name,
                collection.Icon,
                collection.Color,
                collection.IsFavorite,
                collection.IsLocked,
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc,
                collection.IconImageBlobName,
            })
            .ToListAsync(cancellationToken);
        if (collections.Count == 0)
        {
            return [];
        }

        var shares = (await (
                from share in dbContext.CollectionShares.AsNoTracking()
                join collection in dbContext.Collections.AsNoTracking() on share.CollectionId equals collection.Id
                where collection.UserId == userId && collection.DeletedAtUtc == null
                select new { share.Id, share.CollectionId, share.PublicId, share.IsActive, share.IsPublic, share.Permission })
            .ToListAsync(cancellationToken))
            // A Collection can have several link rows over its life (a revoked link stays as history, a new link is a new row): export the
            // ACTIVE one, else the most recent revoked one - never a duplicate key.
            .GroupBy(share => share.CollectionId)
            .ToDictionary(group => group.Key, group => group.OrderByDescending(share => share.IsActive).ThenByDescending(share => share.Id).First());

        var roleCounts = await (
                from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
                join collection in dbContext.Collections.AsNoTracking() on collaborator.CollectionId equals collection.Id
                where collection.UserId == userId && collection.DeletedAtUtc == null
                group collaborator by new { collaborator.CollectionId, collaborator.Role } into grouped
                select new { grouped.Key.CollectionId, grouped.Key.Role, Count = grouped.Count() })
            .ToListAsync(cancellationToken);

        int CountOf(long collectionId, CollectionCollaboratorRole role) =>
            roleCounts.FirstOrDefault(entry => entry.CollectionId == collectionId && entry.Role == role)?.Count ?? 0;

        return collections
            .Select(collection => new DataExportOwnedCollection(
                collection.Id,
                collection.Name,
                JsonNamingPolicy.CamelCase.ConvertName(collection.Icon.ToString()),
                collection.Color,
                collection.IsFavorite,
                collection.IsLocked,
                collection.CreatedAtUtc,
                collection.UpdatedAtUtc,
                collection.IconImageBlobName,
                shares.TryGetValue(collection.Id, out var share)
                    ? new DataExportShare(share.PublicId, share.IsActive, share.IsPublic, JsonNamingPolicy.CamelCase.ConvertName(share.Permission.ToString()))
                    : null,
                new DataExportMemberCounts(
                    CountOf(collection.Id, CollectionCollaboratorRole.Contributor),
                    CountOf(collection.Id, CollectionCollaboratorRole.Submitter),
                    CountOf(collection.Id, CollectionCollaboratorRole.Viewer))))
            .ToList();
    }

    public async IAsyncEnumerable<DataExportCollectionEntry> ReadOwnedCollectionEntriesAsync(
        long userId,
        long collectionId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var owned = await dbContext.Collections
            .AsNoTracking()
            .AnyAsync(collection => collection.Id == collectionId && collection.UserId == userId && collection.DeletedAtUtc == null, cancellationToken);
        if (!owned)
        {
            yield break;
        }

        int? afterSortOrder = null;
        long afterId = 0;
        while (true)
        {
            var query =
                from membership in dbContext.CollectionItems.AsNoTracking()
                join item in dbContext.Items.AsNoTracking() on membership.ItemId equals item.Id
                where membership.CollectionId == collectionId && item.DeletedAtUtc == null
                select new { membership.Id, membership.SortOrder, membership.AddedAtUtc, item.UserId, ItemId = item.Id, item.Url, item.Title, item.PreviewImageUrl };
            if (afterSortOrder is { } sortOrder)
            {
                var lastId = afterId;
                query = query.Where(entry => entry.SortOrder > sortOrder || (entry.SortOrder == sortOrder && entry.Id > lastId));
            }

            var page = await query
                .OrderBy(entry => entry.SortOrder)
                .ThenBy(entry => entry.Id)
                .Take(PageSize)
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            foreach (var entry in page)
            {
                var mine = entry.UserId == userId;
                // Another member's link: only what every member sees - never its memo, photos, item id or who added it.
                yield return mine
                    ? new DataExportCollectionEntry(collectionId, true, entry.ItemId, null, null, null, entry.AddedAtUtc)
                    : new DataExportCollectionEntry(collectionId, false, null, entry.Url, entry.Title, entry.PreviewImageUrl, entry.AddedAtUtc);
            }

            afterSortOrder = page[^1].SortOrder;
            afterId = page[^1].Id;
        }
    }

    public async Task<IReadOnlyList<DataExportMembership>> GetMembershipsAsync(long userId, CancellationToken cancellationToken = default) =>
        (await MembershipsQuery(userId).ToListAsync(cancellationToken))
        .Select(entry => new DataExportMembership(entry.CollectionId, entry.Name, JsonNamingPolicy.CamelCase.ConvertName(entry.Role.ToString()), entry.JoinedAtUtc))
        .ToList();

    public async IAsyncEnumerable<DataExportComment> ReadCommentsAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long afterId = 0;
        while (true)
        {
            var page = await dbContext.CollectionItemComments
                .AsNoTracking()
                .Where(comment => comment.UserId == userId && comment.DeletedAtUtc == null && comment.Id > afterId)
                .OrderBy(comment => comment.Id)
                .Take(PageSize)
                .Select(comment => new DataExportComment(comment.Id, comment.CollectionId, comment.ItemId, comment.Body, comment.CreatedAtUtc, comment.ParentCommentId != null))
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            foreach (var comment in page)
            {
                yield return comment;
            }

            afterId = page[^1].Id;
        }
    }

    public async IAsyncEnumerable<DataExportPurchase> ReadPurchasesAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long afterId = 0;
        while (true)
        {
            var page = await dbContext.Purchases
                .AsNoTracking()
                .Where(purchase => purchase.UserId == userId && purchase.Id > afterId)
                .OrderBy(purchase => purchase.Id)
                .Take(PageSize)
                .Select(purchase => new DataExportPurchase(
                    purchase.Id,
                    purchase.ItemId,
                    purchase.PurchaseDate,
                    purchase.ProductName,
                    purchase.Amount,
                    purchase.CurrencyCode,
                    purchase.Store,
                    purchase.Variant,
                    purchase.Quantity,
                    purchase.Memo,
                    purchase.CreatedAtUtc))
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            foreach (var purchase in page)
            {
                yield return purchase;
            }

            afterId = page[^1].Id;
        }
    }

    public async IAsyncEnumerable<DataExportRepeatPurchase> ReadRepeatPurchasesAsync(long userId, [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        long afterId = 0;
        while (true)
        {
            var page = await dbContext.RepeatPurchases
                .AsNoTracking()
                .Where(repeat => repeat.UserId == userId && repeat.Id > afterId)
                .OrderBy(repeat => repeat.Id)
                .Take(PageSize)
                .Select(repeat => new
                {
                    repeat.Id,
                    repeat.ItemId,
                    repeat.ProductName,
                    repeat.IntervalValue,
                    repeat.IntervalUnit,
                    repeat.NextPurchaseDate,
                    repeat.IsReminderEnabled,
                    repeat.ReminderLeadDays,
                    repeat.IsEnabled,
                    repeat.CreatedAtUtc,
                })
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            foreach (var repeat in page)
            {
                yield return new DataExportRepeatPurchase(
                    repeat.Id,
                    repeat.ItemId,
                    repeat.ProductName,
                    repeat.IntervalValue,
                    JsonNamingPolicy.CamelCase.ConvertName(repeat.IntervalUnit.ToString()),
                    repeat.NextPurchaseDate,
                    repeat.IsReminderEnabled,
                    repeat.ReminderLeadDays,
                    repeat.IsEnabled,
                    repeat.CreatedAtUtc);
            }

            afterId = page[^1].Id;
        }
    }

    public async IAsyncEnumerable<DataExportImageRef> ReadImagesAsync(
        long userId,
        long? fromImageId,
        long? throughImageId,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        var afterId = (fromImageId ?? 1) - 1;
        var through = throughImageId ?? long.MaxValue;
        while (true)
        {
            var lastId = afterId;
            var page = await OwnImagesQuery(userId)
                .Where(image => image.Id > lastId && image.Id <= through)
                .OrderBy(image => image.Id)
                .Take(PageSize)
                .Select(image => new DataExportImageRef(image.Id, image.ItemId, image.BlobName, image.ContentType, image.ByteLength))
                .ToListAsync(cancellationToken);
            if (page.Count == 0)
            {
                yield break;
            }

            foreach (var image in page)
            {
                yield return image;
            }

            afterId = page[^1].ImageId;
        }
    }

    /// <summary>Photos of the person's own links (trash included) - never another person's.</summary>
    private IQueryable<Juple.Domain.Images.ItemImage> OwnImagesQuery(long userId) =>
        from image in dbContext.ItemImages.AsNoTracking()
        join item in dbContext.Items.AsNoTracking() on image.ItemId equals item.Id
        where item.UserId == userId
        select image;

    /// <summary>Shared Collections someone ELSE owns that the person currently belongs to (not deleted).</summary>
    private IQueryable<MembershipRow> MembershipsQuery(long userId) =>
        from collaborator in dbContext.CollectionCollaborators.AsNoTracking()
        join collection in dbContext.Collections.AsNoTracking() on collaborator.CollectionId equals collection.Id
        where collaborator.UserId == userId && collection.UserId != userId && collection.DeletedAtUtc == null
        orderby collection.Id
        select new MembershipRow(collection.Id, collection.Name, collaborator.Role, collaborator.CreatedAtUtc);

    private sealed record MembershipRow(long CollectionId, string Name, CollectionCollaboratorRole Role, DateTimeOffset JoinedAtUtc);
}
