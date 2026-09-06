namespace Juple.Application.Collections.EnableCollectionShare;

public sealed class EnableCollectionShareService(
    ICollectionShareStore collectionShareStore,
    TimeProvider timeProvider) : IEnableCollectionShareService
{
    public Task<CollectionShareDto> EnableAsync(
        long userId,
        long collectionId,
        CancellationToken cancellationToken = default) =>
        collectionShareStore.EnableAsync(
            userId, collectionId, CollectionSharePublicIdGenerator.Generate(), timeProvider.GetUtcNow(), cancellationToken);
}
