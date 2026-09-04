using Juple.Application.Images;

namespace Juple.Application.Collections.GetCollectionItems;

public sealed class GetCollectionItemsService(
    ICollectionItemStore collectionItemStore,
    IItemImageStorage itemImageStorage) : IGetCollectionItemsService
{
    public async Task<CollectionItemPage> GetAsync(
        long userId,
        long collectionId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var (page, representativeImages) = await collectionItemStore.GetItemsAsync(
            userId, collectionId, cursor, limit, cancellationToken);

        var enrichedItems = new List<CollectionItemEntryDto>(page.Items.Count);
        foreach (var item in page.Items)
        {
            var representativeImage = representativeImages.TryGetValue(item.ItemId, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage });
        }

        return new CollectionItemPage(enrichedItems, page.NextCursor);
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
