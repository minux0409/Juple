namespace Juple.Application.Collections.EnableCollectionShare;

public interface IEnableCollectionShareService
{
    Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default);
}
