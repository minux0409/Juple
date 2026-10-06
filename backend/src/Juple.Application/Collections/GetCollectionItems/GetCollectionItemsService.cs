using Juple.Application.Collections.Access;
using Juple.Application.Collections.Reactions;
using Juple.Application.Images;
using Juple.Application.Items;

namespace Juple.Application.Collections.GetCollectionItems;

public sealed class GetCollectionItemsService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    IItemImageStorage itemImageStorage,
    ICollectionItemReactionStore? reactions = null) : IGetCollectionItemsService
{
    public async Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CollectionItemSort sort = CollectionItemSort.Manual,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);

        var (page, representativeImages, coverImages) = await collectionItemStore.GetItemsAsync(
            userId, collectionId, cursor, limit, sort, cancellationToken);
        return await EnrichAsync(userId, collectionId, page, representativeImages, coverImages, cancellationToken);
    }

    public async Task<CollectionItemPage> GetRangeAsync(
        long userId,
        long collectionId,
        DateTimeOffset fromUtc,
        DateTimeOffset toUtc,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);

        var (page, representativeImages, coverImages) = await collectionItemStore.GetItemsInRangeAsync(
            userId, collectionId, fromUtc, toUtc, cursor, limit, sort, cancellationToken);
        return await EnrichAsync(userId, collectionId, page, representativeImages, coverImages, cancellationToken);
    }

    public async Task<CollectionItemPage> SearchAsync(
        long userId,
        long collectionId,
        string searchTerm,
        CollectionItemPageCursor? cursor,
        int limit,
        CollectionItemSort sort,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);

        var (page, representativeImages, coverImages) = await collectionItemStore.SearchItemsAsync(
            userId, collectionId, ItemSearchPattern.ToContainsPattern(searchTerm), cursor, limit, sort, cancellationToken);
        return await EnrichAsync(userId, collectionId, page, representativeImages, coverImages, cancellationToken);
    }

    private async Task<CollectionItemPage> EnrichAsync(
        long userId,
        long collectionId,
        CollectionItemPage page,
        IReadOnlyDictionary<long, ItemRepresentativeImageRef> representativeImages,
        IReadOnlyDictionary<long, ItemRepresentativeImageRef> coverImages,
        CancellationToken cancellationToken)
    {
        // The whole page's reactions in two statements (never one per link).
        var summaries = reactions is null
            ? new Dictionary<long, CollectionItemReactionsDto>()
            : await reactions.GetSummariesAsync(userId, collectionId, [.. page.Items.Select(entry => entry.ItemId)], cancellationToken);
        var enrichedItems = new List<CollectionItemEntryDto>(page.Items.Count);
        foreach (var item in page.Items)
        {
            // Uploaded-image refs only ever exist for the viewer's own Items (the store never
            // selects them for anyone else's), and read URLs are always minted for the viewer's
            // own storage prefix.
            var representativeImage = item.IsMine && representativeImages.TryGetValue(item.ItemId, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            var coverImage = item.IsMine && coverImages.TryGetValue(item.ItemId, out var coverReference)
                ? await ResolveRepresentativeImageAsync(userId, coverReference, cancellationToken)
                : null;
            summaries.TryGetValue(item.ItemId, out var summary);
            enrichedItems.Add(item with
            {
                RepresentativeImage = representativeImage,
                CoverImage = coverImage,
                Reactions = summary?.Reactions,
                MyReaction = summary?.MyReaction,
            });
        }

        return new CollectionItemPage(enrichedItems, page.NextCursor);
    }

    public async Task<SharedCollectionItemDto?> GetItemAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var shared = await collectionItemStore.GetSharedItemAsync(userId, collectionId, itemId, cancellationToken);
        if (shared is null || reactions is null)
        {
            return shared;
        }

        var summaries = await reactions.GetSummariesAsync(userId, collectionId, [itemId], cancellationToken);
        return summaries.TryGetValue(itemId, out var summary) ? shared with { Reactions = summary.Reactions, MyReaction = summary.MyReaction } : shared;
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        // Same degrade-gracefully policy as GetItemHistoryService/GetDailyInboxService: a
        // failed/missing read URL drops the representative image for this one Item rather than
        // failing the whole page.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
