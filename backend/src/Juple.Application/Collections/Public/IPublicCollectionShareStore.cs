using Juple.Application.Collections;

namespace Juple.Application.Collections.Public;

/// <summary>
/// The anonymous read side of Collection sharing - resolves a public share's PublicId directly,
/// with no userId in sight anywhere in this contract. Both methods return null under the exact
/// same rule: publicId does not exist, or its share has been revoked. Callers (see
/// PublicCollectionsController) must map null to a plain 404 in both cases - never a different
/// response that would let a caller distinguish "never existed" from "revoked".
/// </summary>
public interface IPublicCollectionShareStore
{
    Task<PublicCollectionDto?> GetCollectionAsync(string publicId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Same cursor-paginated AddedAtUtc DESC, ItemId DESC ordering as the authenticated
    /// GetCollectionItems - a Collection's Item list is unbounded here too.
    /// </summary>
    Task<PublicCollectionItemPage?> GetItemsAsync(
        string publicId,
        CollectionItemPageCursor? cursor,
        int limit,
        CancellationToken cancellationToken = default);
}
