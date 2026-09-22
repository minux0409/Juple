namespace Juple.Application.Collections.MergeCollections;

public interface IMergeCollectionsService
{
    Task<MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        CancellationToken cancellationToken = default);
}
