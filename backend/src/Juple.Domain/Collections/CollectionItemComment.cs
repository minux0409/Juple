namespace Juple.Domain.Collections;

/// <summary>
/// One participant's comment on one link of a Collection - a short plain-text note in the link's
/// conversation. Comments form one-level threads (Instagram style): a top-level comment has no
/// RootCommentId; every reply carries the id of the top-level comment it hangs under (RootCommentId)
/// and of the exact comment it answers (ParentCommentId, equal to the root for a direct reply), plus
/// the answered person (ReplyToUserId, set by the server from the parent - never taken from the
/// text, so a typed "@name" is only text). Clients draw every reply of a thread at one indent level.
///
/// A comment nobody answered is hard-deleted. A comment that others answered is never deleted out
/// from under them: it becomes a tombstone (DeletedAtUtc set, Body empty, UserId cleared - so nothing
/// of the author or the words remains) and its replies stay; the tombstone itself goes once its last
/// reply is gone. The row hangs off the link's membership (CollectionItem) and goes with it - when
/// the link leaves the Collection, or the Collection or the Item itself is deleted. It does NOT go
/// when its author leaves the Collection (the conversation keeps its context), only when the author's
/// account is deleted (see AccountDeletionStore). Comments are ordered by Id: identity values grow
/// with every insert, so Id is the stable creation order (and the paging cursor).
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

    /// <summary>A reply: parent is the exact comment answered; the thread root and the answered person follow from it.</summary>
    public CollectionItemComment(CollectionItemComment parent, long userId, string body, DateTimeOffset createdAtUtc)
        : this(parent.CollectionId, parent.ItemId, userId, body, createdAtUtc)
    {
        RootCommentId = parent.RootCommentId ?? parent.Id;
        ParentCommentId = parent.Id;
        ReplyToUserId = parent.UserId;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public long ItemId { get; private set; }

    /// <summary>The author; null only on a tombstone (the words and the person are both gone).</summary>
    public long? UserId { get; private set; }

    /// <summary>Plain text, trimmed, 1..1000 characters; never rendered as HTML or markdown. Empty only on a tombstone.</summary>
    public string Body { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    /// <summary>The top-level comment this reply hangs under; null for a top-level comment.</summary>
    public long? RootCommentId { get; private set; }

    /// <summary>The comment this reply answers (the root itself for a direct reply); null for a top-level comment.</summary>
    public long? ParentCommentId { get; private set; }

    /// <summary>The person this reply answers - the parent's author when it was written; cleared if that account is deleted.</summary>
    public long? ReplyToUserId { get; private set; }

    /// <summary>Set once the comment was deleted while replies to it remain; the row is then a placeholder only.</summary>
    public DateTimeOffset? DeletedAtUtc { get; private set; }

    public bool IsTombstone => DeletedAtUtc is not null;

    /// <summary>
    /// Replaces the words of a live comment. Nothing else about it changes: not the author, the thread (root / parent), the
    /// answered person (a reply's "@name" is metadata, never part of the text), the hearts or the time it was written.
    /// A tombstone has no words to edit.
    /// </summary>
    public void EditBody(string body)
    {
        if (IsTombstone)
        {
            throw new InvalidOperationException("A deleted comment cannot be edited.");
        }

        Body = body;
    }

    /// <summary>Turns the comment into a tombstone: no words, no author, nothing a reader could attribute.</summary>
    public void Tombstone(DateTimeOffset deletedAtUtc)
    {
        Body = string.Empty;
        UserId = null;
        DeletedAtUtc = deletedAtUtc;
    }
}
