using Juple.Application.Images;

namespace Juple.Application.Items.GetItemTrash;

public sealed class GetItemTrashService(
    IItemTrashQueryStore itemTrashQueryStore,
    IItemImageStorage itemImageStorage) : IGetItemTrashService
{
    public async Task<IReadOnlyList<ItemTrashEntryDto>> GetAsync(
        long userId, CancellationToken cancellationToken = default)
    {
        var (items, representativeImages, coverImages) =
            await itemTrashQueryStore.ListTrashAsync(userId, ItemTrashLimits.ListLimit, cancellationToken);

        var enrichedItems = new List<ItemTrashEntryDto>(items.Count);
        foreach (var item in items)
        {
            var representativeImage = representativeImages.TryGetValue(item.Id, out var reference)
                ? await ResolveRepresentativeImageAsync(userId, reference, cancellationToken)
                : null;
            var coverImage = coverImages.TryGetValue(item.Id, out var coverReference)
                ? await ResolveRepresentativeImageAsync(userId, coverReference, cancellationToken)
                : null;
            enrichedItems.Add(item with { RepresentativeImage = representativeImage, CoverImage = coverImage });
        }

        return enrichedItems;
    }

    private async Task<RepresentativeImageDto?> ResolveRepresentativeImageAsync(
        long userId, ItemRepresentativeImageRef reference, CancellationToken cancellationToken)
    {
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
