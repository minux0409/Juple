namespace Juple.Application.Collections.MergeCollections;

public interface IMergeCollectionsService
{
    /// <remarks>unlockToken may carry grants for both Collections, comma-separated.</remarks>
    Task<MergeCollectionsResult> MergeAsync(long userId, long sourceCollectionId, long targetCollectionId,
        string? unlockToken = null, CancellationToken cancellationToken = default);
}
