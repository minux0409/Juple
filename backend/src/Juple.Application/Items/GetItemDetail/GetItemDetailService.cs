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
        var (details, reference) = await itemDetailQueryStore.GetDetailsAsync(userId, itemId, cancellationToken);
        if (details is null)
        {
            throw new ItemNotFoundException();
        }

        RepresentativeImageDto? representativeImage = null;
        if (reference is not null)
        {
            // See GetDailyInboxService's identical policy: a failed/missing read URL degrades to
            // no representative image rather than failing the whole detail request.
            var readUrl = await itemImageStorage.CreateReadUrlAsync(userId, reference.BlobName, cancellationToken);
            representativeImage = readUrl is null ? null : new RepresentativeImageDto(reference.ImageId, readUrl);
        }

        return details with { RepresentativeImage = representativeImage };
    }
}
