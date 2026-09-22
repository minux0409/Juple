namespace Juple.Application.Collections.RestoreCollection;

public interface IRestoreCollectionService
{
    Task RestoreAsync(long userId, long collectionId, CancellationToken cancellationToken = default);
}
