using Juple.Application.Images;

namespace Juple.Application.Items.GetItemHistory;

public sealed class GetItemHistoryService(
    IItemHistoryQueryStore itemHistoryQueryStore,
    IItemImageStorage itemImageStorage) : IGetItemHistoryService
{
    public async Task<ItemHistoryPage> GetAsync(
        long userId,
        ItemHistoryPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var (page, representativeImages) = await itemHistoryQueryStore.GetHistoryAsync(
            userId, cursor, limit, cancellationToken);

        var enrichedItems = new List<ItemHistoryEntryDto>(page.Items.Count);
        foreach (var item in page.Items)
        {
            var representativeImage = representativeImages.TryGetValue(item.Id, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage });
        }

        return new ItemHistoryPage(enrichedItems, page.NextCursor);
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        // A failed/missing read URL drops the representative image for this one Item rather than
        // failing the whole page.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
