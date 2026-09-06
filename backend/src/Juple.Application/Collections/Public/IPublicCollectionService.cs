using Juple.Application.Collections;

namespace Juple.Application.Collections.Public;

public interface IPublicCollectionService
{
    Task<PublicCollectionDto?> GetCollectionAsync(string publicId, CancellationToken cancellationToken = default);

    Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
