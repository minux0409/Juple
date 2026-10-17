using Juple.Application.Collections;
using Juple.Application.Safety;

namespace Juple.Application.Friends;

public interface IFriendSharedCollectionsService
{
    /// <summary>
    /// The Collections the caller and one of the caller's friends both take part in, as the caller's own list shows them (their role,
    /// lock state, icon). Throws <see cref="FriendNotFoundException"/> for a friendship that is not the caller's.
    /// </summary>
    Task<CollectionPage> ListAsync(long userId, long friendshipId, CollectionPageCursor? cursor, int limit, CancellationToken cancellationToken = default);
}

/// <summary>
/// Only an ACCEPTED friendship of the caller opens this, and a block in either direction answers an empty list (the blocked side is not
/// told anything). Memberships only: a Collection both merely know a public link of is never listed, nor one either has left or been
/// removed from (membership rows are gone then), nor a deleted one. Nothing is read that the caller's own Collections list does not
/// already give them - a locked Collection shows its lock state, never its content.
/// </summary>
public sealed class FriendSharedCollectionsService(
    IFriendStore friendStore,
    ICollectionStore collectionStore,
    IUserBlockPolicy blocks) : IFriendSharedCollectionsService
{
    public async Task<CollectionPage> ListAsync(long userId, long friendshipId, CollectionPageCursor? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var friendUserId = await friendStore.FindFriendUserIdAsync(userId, friendshipId, cancellationToken)
            ?? throw new FriendNotFoundException();
        if (await blocks.AreBlockedAsync(userId, friendUserId, cancellationToken))
        {
            return new CollectionPage([], null);
        }

        return await collectionStore.ListSharedWithUserAsync(userId, friendUserId, cursor, limit, cancellationToken);
    }
}
