namespace Juple.Application.Collections.MergeCollections;

public interface IMergeCollectionsService
{
    Task MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        CancellationToken cancellationToken = default);
}
