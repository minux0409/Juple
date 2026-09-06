using Juple.Application.Collections;

namespace Juple.Application.Collections.Public;

public sealed class PublicCollectionService(IPublicCollectionShareStore publicCollectionShareStore)
    : IPublicCollectionService
{
    public Task<PublicCollectionDto?> GetCollectionAsync(string publicId, CancellationToken cancellationToken = default) =>
        publicCollectionShareStore.GetCollectionAsync(publicId, cancellationToken);

    public Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default) =>
        publicCollectionShareStore.GetItemsAsync(publicId, cursor, limit, cancellationToken);
}
