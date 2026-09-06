namespace Juple.Application.Collections.RevokeCollectionShare;

public sealed class RevokeCollectionShareService(
    ICollectionShareStore collectionShareStore,
    TimeProvider timeProvider) : IRevokeCollectionShareService
{
    public Task RevokeAsync(long userId, long collectionId, CancellationToken cancellationToken = default) =>
        collectionShareStore.RevokeAsync(userId, collectionId, timeProvider.GetUtcNow(), cancellationToken);
}
