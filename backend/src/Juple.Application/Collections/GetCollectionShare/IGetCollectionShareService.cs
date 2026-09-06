namespace Juple.Application.Collections.GetCollectionShare;

public interface IGetCollectionShareService
{
    Task<CollectionShareDto?> GetAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default);
}
