namespace Juple.Application.Collections.GetCollectionDetail;

public interface IGetCollectionDetailService
{
    /// <summary>Throws CollectionNotFoundException when collectionId is missing or not owned by userId.</summary>
    Task<CollectionDto> GetAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
