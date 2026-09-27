using Juple.Application.Collections.Access;
using Juple.Application.Images;

namespace Juple.Application.Collections.GetCollectionItems;

public sealed class GetCollectionItemsService(
    ICollectionAccessService accessService,
    ICollectionItemStore collectionItemStore,
    IItemImageStorage itemImageStorage) : IGetCollectionItemsService
{
    public async Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        string? unlockToken = null,
        CancellationToken cancellationToken = default)
    {
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);

        var (page, representativeImages, coverImages) = await collectionItemStore.GetItemsAsync(
            userId, collectionId, cursor, limit, cancellationToken);

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
            enrichedItems.Add(item with { RepresentativeImage = representativeImage, CoverImage = coverImage });
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
        return await collectionItemStore.GetSharedItemAsync(userId, collectionId, itemId, cancellationToken);
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
