namespace Juple.Domain.Collections;

/// <summary>
/// One person's heart on one comment - at most one per person per comment (a database rule: unique
/// (CommentId, UserId), so two fast taps or a retried request can never count twice). Unliking
/// deletes the row. The row goes with its comment.
/// </summary>
public sealed class CollectionItemCommentLike
{
    private CollectionItemCommentLike()
    {
    }

    public CollectionItemCommentLike(long commentId, long userId, DateTimeOffset createdAtUtc)
    {
        CommentId = commentId;
        UserId = userId;
        CreatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    public long CommentId { get; private set; }

    public long UserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }
}
