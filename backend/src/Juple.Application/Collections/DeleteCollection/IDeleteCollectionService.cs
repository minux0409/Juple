namespace Juple.Application.Collections.DeleteCollection;

public interface IDeleteCollectionService
{
    Task DeleteAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
