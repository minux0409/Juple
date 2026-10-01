namespace Juple.Domain.Collections;

/// <summary>
/// One participant's emoji reaction to one link of a Collection - at most one per person per link
/// (a database rule: unique (CollectionId, ItemId, UserId)). Changing it rewrites ReactionKey in
/// place, so two reactions of the same person never exist at once. ReactionKey is a stable catalog
/// key (see CollectionReactionCatalog), never raw Unicode. The row hangs off the link's membership
/// (CollectionItem) and disappears with it - when the link leaves the Collection, or the Collection
/// or the Item itself is deleted.
/// </summary>
public sealed class CollectionItemReaction
{
    private CollectionItemReaction()
    {
        ReactionKey = string.Empty;
    }

    public CollectionItemReaction(long collectionId, long itemId, long userId, string reactionKey, DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        UserId = userId;
        ReactionKey = reactionKey;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    public long UserId { get; private set; }

    public string ReactionKey { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
