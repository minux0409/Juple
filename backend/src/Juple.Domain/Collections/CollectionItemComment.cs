namespace Juple.Domain.Collections;

/// <summary>
/// One participant's comment on one link of a Collection - a short plain-text note in the link's
/// conversation. Hard-deleted (there are no replies, no history and no "deleted" placeholder), so
/// there is no DeletedAtUtc. The row hangs off the link's membership (CollectionItem) and goes with
/// it - when the link leaves the Collection, or the Collection or the Item itself is deleted. It
/// does NOT go when its author leaves the Collection (the conversation keeps its context), only when
/// the author's account is deleted. Comments are ordered by Id: identity values grow with every
/// insert, so Id is the stable creation order (and the paging cursor).
/// </summary>
public sealed class CollectionItemComment
{
    private CollectionItemComment()
    {
        Body = string.Empty;
    }

    public CollectionItemComment(long collectionId, long itemId, long userId, string body, DateTimeOffset createdAtUtc)
    {
        CollectionId = collectionId;
        ItemId = itemId;
        UserId = userId;
        Body = body;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    public long UserId { get; private set; }

    /// <summary>Plain text, trimmed, 1..1000 characters; never rendered as HTML or markdown.</summary>
    public string Body { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
