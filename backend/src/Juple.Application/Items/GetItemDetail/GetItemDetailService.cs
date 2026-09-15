using Juple.Application.Images;

namespace Juple.Application.Items.GetItemDetail;

public sealed class GetItemDetailService(
    IItemDetailQueryStore itemDetailQueryStore,
    IItemImageStorage itemImageStorage) : IGetItemDetailService
{
    public async Task<ItemDetailsDto> GetAsync(
        long userId,
        long itemId,
        CancellationToken cancellationToken = default)
    {
        var (details, reference, coverReference) =
            await itemDetailQueryStore.GetDetailsAsync(userId, itemId, cancellationToken);
        if (details is null)
        {
            throw new ItemNotFoundException();
        }

        var representativeImage = await ResolveAsync(userId, reference, cancellationToken);
        var coverImage = await ResolveAsync(userId, coverReference, cancellationToken);

        return details with { RepresentativeImage = representativeImage, CoverImage = coverImage };
    }

    private async Task<RepresentativeImageDto?> ResolveAsync(
        long userId, ItemRepresentativeImageRef? reference, CancellationToken cancellationToken)
    {
        if (reference is null)
        {
            return null;
        }

        // A failed/missing read URL degrades to no image rather than failing the whole detail
        // request.
        var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
        return readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
    }
}
