using Juple.Application.Collections.Submissions;

namespace Juple.Application.Collections.AddItemToCollection;

public interface IAddItemToCollectionService
{
    /// <summary>Added (now a link of the Collection, or already was), or Submitted - waiting for the Owner (승인 후 추가).</summary>
    Task<CollectionLinkAddOutcome> AddAsync(
        long userId,
        long collectionId,
        long itemId,
        string? unlockToken = null,
        CancellationToken cancellationToken = default);
}
