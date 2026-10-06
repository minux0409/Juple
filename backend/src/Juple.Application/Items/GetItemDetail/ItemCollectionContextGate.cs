using Juple.Application.Collections.Access;

namespace Juple.Application.Items.GetItemDetail;

public interface IItemCollectionContextGate
{
    /// <summary>
    /// The Collection context a link is being opened IN (a Home/Archive card gated by that Collection): the caller must
    /// pass that Collection's CURRENT content gate - for its Owner the Collection lock (no Owner bypass), for a member
    /// the Collection's share password or, on a legacy Collection, the lock - with a valid grant for THIS Collection, and
    /// the Item must be the caller's own and actually in that Collection. Otherwise nothing of the Item is read.
    /// Throws CollectionNotFoundException (no access), CollectionLockedException / CollectionSharePasswordRequiredException
    /// (gated without a valid grant) or ItemNotFoundException (not the caller's, or not in that Collection).
    /// </summary>
    Task RequireAsync(long userId, long itemId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// Enforces the lock of the Collection a link is opened through - the server-side half of the Home/Archive locked card
/// (whose list row is already redacted by the history query). Context-aware on purpose: the same Item may also be in
/// other, unlocked Collections, so one locked reference never locks the Item everywhere - only a read made in the
/// locked Collection's context is gated. A read without a context keeps its original, ownership-only behavior.
/// </summary>
public sealed class ItemCollectionContextGate(
    ICollectionAccessService accessService,
    IItemDetailQueryStore itemDetailQueryStore) : IItemCollectionContextGate
{
    public async Task RequireAsync(long userId, long itemId, long collectionId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        // The Collection first: no access answers 404, a current gate without its grant is refused - before anything
        // about the Item (even whether it is in that Collection) is looked at.
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        if (!await itemDetailQueryStore.IsInCollectionAsync(userId, itemId, collectionId, cancellationToken))
        {
            throw new ItemNotFoundException();
        }
    }
}
