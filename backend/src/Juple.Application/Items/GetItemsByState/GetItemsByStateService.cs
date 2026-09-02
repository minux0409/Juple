using Juple.Application.Images;
using Juple.Domain.Items;

namespace Juple.Application.Items.GetItemsByState;

public sealed class GetItemsByStateService(
    IItemQueryStore itemQueryStore,
    IItemImageStorage itemImageStorage) : IGetItemsByStateService
{
    public async Task<ItemPage> GetAsync(
        long userId,
        ItemState state,
        long? categoryId,
        ItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var (page, representativeImages) = await itemQueryStore.GetByStateAsync(
            userId, state, categoryId, cursor, limit, cancellationToken);

        var enrichedItems = new List<ItemListEntryDto>(page.Items.Count);
        foreach (var item in page.Items)
        {
            var representativeImage = representativeImages.TryGetValue(item.Id, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage });
        }

        return new ItemPage(enrichedItems, page.NextCursor);
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        // See GetDailyInboxService's identical policy: a failed/missing read URL degrades to no
        // representative image for this one Item rather than failing the whole list.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
