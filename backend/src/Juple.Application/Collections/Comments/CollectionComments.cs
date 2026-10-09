using Juple.Application.Collections.Access;
using Juple.Application.Notifications;

namespace Juple.Application.Collections.Comments;

/// <summary>Who wrote a comment, as the Collection's own people may see them (the same identity the participant list shows).</summary>
public sealed record CollectionCommentAuthorDto(
    string JupleId,
    string? DisplayName,
    string? ProfileImageUrl,
    string? ProfileImageVersion,
    bool IsCollectionOwner,
    bool IsMe);

/// <summary>The person a reply answers, named (never an id) - only for a reply to another REPLY; a direct reply is already under its parent.</summary>
public sealed record CollectionCommentReplyTargetDto(string JupleId, string? DisplayName);

/// <summary>
/// One comment. The thread fields are additive (an older client ignores them): RootCommentId/ParentCommentId are set on a reply;
/// ReplyCount is the number of live replies under a top-level comment; LikeCount/ViewerLiked are its hearts. IsDeleted marks a
/// tombstone - a deleted comment that others answered: Body is empty and Author is an empty placeholder (nothing of the person remains).
/// </summary>
public sealed record CollectionCommentDto(
    long Id,
    string Body,
    DateTimeOffset CreatedAtUtc,
    CollectionCommentAuthorDto Author,
    long? RootCommentId = null,
    long? ParentCommentId = null,
    CollectionCommentReplyTargetDto? ReplyTo = null,
    int ReplyCount = 0,
    int LikeCount = 0,
    bool ViewerLiked = false,
    bool IsDeleted = false);

/// <summary>
/// One page of a link's TOP-LEVEL comments, oldest first. PreviousCursor is the id to pass as "before" for the
/// next older page (null when this page starts at the oldest comment); TotalCount is every live comment
/// on the link, replies included (the number the conversation's title shows).
/// </summary>
public sealed record CollectionCommentPageDto(IReadOnlyList<CollectionCommentDto> Items, long? PreviousCursor, int TotalCount);

/// <summary>
/// One page of a thread's replies, oldest first. NextCursor is the id to pass as "after" for the next page (null when this
/// page ends at the newest reply); TotalCount is every live reply of the thread.
/// </summary>
public sealed record CollectionCommentReplyPageDto(IReadOnlyList<CollectionCommentDto> Items, long? NextCursor, int TotalCount);

/// <summary>A comment's hearts after a like / unlike: whether the caller has liked it and how many hearts it has.</summary>
public sealed record CommentLikeStateDto(bool Liked, int LikeCount);

/// <summary>What the store reports for a new comment: the comment as stored, and - for a reply - the person it answers.</summary>
public sealed record CollectionCommentCreated(CollectionCommentDto Comment, long? ReplyToUserId);

/// <summary>What the store reports for a like / unlike: the state after it, whether this call changed anything, and the comment's author.</summary>
public sealed record CommentLikeOutcome(CommentLikeStateDto State, bool Changed, long? AuthorUserId);

public enum CommentDeleteResult
{
    Deleted,

    /// <summary>It is gone already - the wanted end state.</summary>
    Absent,

    /// <summary>It is somebody else's and the caller is not the Owner.</summary>
    NotAllowed,
}

public enum CommentEditResult
{
    Edited,

    /// <summary>It is somebody else's comment - only the author may edit.</summary>
    NotAllowed,
}

/// <summary>What the store reports for an edit: the result and - when edited - the comment as stored now (replies and hearts intact).</summary>
public sealed record CommentEditOutcome(CommentEditResult Result, CollectionCommentDto? Comment);

/// <summary>The one rule for what a comment may say.</summary>
public static class CollectionCommentBody
{
    public const int MaxLength = 1000;

    /// <summary>
    /// Trimmed plain text, newlines kept (as \n), 1..MaxLength characters. No control characters other
    /// than line breaks and tabs (so no null bytes). The text is stored as typed - never sanitized into
    /// HTML - and rendered as plain text by every client.
    /// </summary>
    public static string Normalize(string? body)
    {
        var trimmed = (body ?? string.Empty).Replace("\r\n", "\n").Replace('\r', '\n').Trim();
        if (trimmed.Length == 0)
        {
            throw new InvalidCollectionException("body", "A comment cannot be empty.");
        }

        if (trimmed.Length > MaxLength)
        {
            throw new InvalidCollectionException("body", $"A comment may have at most {MaxLength} characters.");
        }

        if (trimmed.Any(character => char.IsControl(character) && character is not '\n' and not '\t'))
        {
            throw new InvalidCollectionException("body", "A comment cannot contain control characters.");
        }

        return trimmed;
    }
}

public interface ICollectionItemCommentStore
{
    /// <summary>
    /// The newest `limit` TOP-LEVEL comments older than beforeId (null = the newest of all), returned oldest
    /// first, with their authors in one batch (each distinct author's profile photo is signed once) and each
    /// one's reply count and hearts in the same query. Null when the Item is not a link of the Collection
    /// (or is in the trash).
    /// </summary>
    Task<CollectionCommentPageDto?> GetPageAsync(
        long userId, long collectionId, long itemId, long? beforeId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// The replies of one thread (the top-level comment rootCommentId), oldest first, the `limit` after afterId
    /// (null = from the first). Null when the Item is not a link of the Collection or the thread does not exist there.
    /// </summary>
    Task<CollectionCommentReplyPageDto?> GetRepliesAsync(
        long userId, long collectionId, long itemId, long rootCommentId, long? afterId, int limit, CancellationToken cancellationToken = default);

    /// <summary>
    /// Adds the comment as the caller's - a reply when parentCommentId is given (the root and the answered person
    /// come from the stored parent, never from the caller). Null when the Item is not a link of the Collection, or
    /// the parent does not exist on this link / was deleted.
    /// </summary>
    Task<CollectionCommentCreated?> CreateAsync(
        long userId, long collectionId, long itemId, string body, DateTimeOffset nowUtc, long? parentCommentId = null, CancellationToken cancellationToken = default);

    /// <summary>
    /// Deletes it when the caller wrote it or isOwner: for good when nobody answered it (and then the placeholder of a
    /// deleted parent whose last reply this was), otherwise it becomes a tombstone and its replies stay. Null when
    /// the Item is not a link of the Collection.
    /// </summary>
    Task<CommentDeleteResult?> DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, bool isOwner, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>
    /// Replaces the words of the caller's OWN live comment. Only the body changes (never the author, thread, answered person,
    /// hearts or creation time). Null when the Item is not a link of the Collection, or the comment does not exist there / is
    /// only a placeholder.
    /// </summary>
    Task<CommentEditOutcome?> EditAsync(
        long userId, long collectionId, long itemId, long commentId, string body, CancellationToken cancellationToken = default);

    /// <summary>
    /// Idempotently sets the caller's heart on a comment of this link. Null when the Item is not a link of the
    /// Collection or the comment does not exist there / was deleted. Changed is false when the heart was already as asked
    /// (a retry, a double tap) - so a notification is only ever caused by a real change.
    /// </summary>
    Task<CommentLikeOutcome?> SetLikeAsync(
        long userId, long collectionId, long itemId, long commentId, bool liked, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

public interface ICollectionItemCommentService
{
    Task<CollectionCommentPageDto> ListAsync(
        long userId, long collectionId, long itemId, long? beforeId, int? limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CollectionCommentReplyPageDto> ListRepliesAsync(
        long userId, long collectionId, long itemId, long rootCommentId, long? afterId, int? limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CollectionCommentDto> CreateAsync(
        long userId, long collectionId, long itemId, string? body, string? unlockToken, long? parentCommentId = null, CancellationToken cancellationToken = default);

    Task DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, string? unlockToken, CancellationToken cancellationToken = default);

    /// <summary>Edits the caller's own comment's words - same body rule as writing one. 403 for somebody else's, 404 for a missing / deleted one.</summary>
    Task<CollectionCommentDto> EditAsync(
        long userId, long collectionId, long itemId, long commentId, string? body, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CommentLikeStateDto> SetLikeAsync(
        long userId, long collectionId, long itemId, long commentId, bool liked, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// Comments are for the Collection's people only: the Owner and accepted members of any role. Anyone
/// else - a pending invitee, a non-member, a holder of the public link - is told the Collection does
/// not exist. The same content gate as reading the links applies (a lock or share password needs its
/// grant first, the Owner included). Writing a comment does not make a link or change the Collection,
/// so a Viewer may comment, reply and heart. The Owner may delete any comment; everyone else only their own.
///
/// Notifications (best-effort outbox events, after the write, never the text): a new TOP-LEVEL comment on
/// someone else's link tells that link's owner; a REPLY tells only the person it answers (not also the link's
/// owner or the thread's root author); a heart tells the comment's author - once per person and comment,
/// however often it is toggled. Nobody is ever told about their own action; deleting and un-hearting tell nobody.
/// </summary>
public sealed class CollectionItemCommentService(
    ICollectionAccessService accessService,
    ICollectionItemCommentStore store,
    TimeProvider timeProvider,
    ISocialNotificationPublisher? notifications = null) : ICollectionItemCommentService
{
    public const int DefaultPageSize = 30;
    public const int MaxPageSize = 100;

    public async Task<CollectionCommentPageDto> ListAsync(
        long userId, long collectionId, long itemId, long? beforeId, int? limit, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (limit is <= 0 || beforeId is <= 0)
        {
            throw new InvalidCollectionException("limit", "limit and cursor must be positive.");
        }

        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        return await store.GetPageAsync(userId, collectionId, itemId, beforeId, Math.Min(limit ?? DefaultPageSize, MaxPageSize), cancellationToken)
            ?? throw new CollectionNotFoundException();
    }

    public async Task<CollectionCommentReplyPageDto> ListRepliesAsync(
        long userId, long collectionId, long itemId, long rootCommentId, long? afterId, int? limit, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (limit is <= 0 || afterId is <= 0 || rootCommentId <= 0)
        {
            throw new InvalidCollectionException("limit", "limit and cursor must be positive.");
        }

        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        return await store.GetRepliesAsync(userId, collectionId, itemId, rootCommentId, afterId, Math.Min(limit ?? DefaultPageSize, MaxPageSize), cancellationToken)
            ?? throw new CollectionNotFoundException();
    }

    public async Task<CollectionCommentDto> CreateAsync(
        long userId, long collectionId, long itemId, string? body, string? unlockToken, long? parentCommentId = null, CancellationToken cancellationToken = default)
    {
        if (parentCommentId is <= 0)
        {
            throw new InvalidCollectionException("parentCommentId", "parentCommentId must be positive.");
        }

        var normalized = CollectionCommentBody.Normalize(body);
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var created = await store.CreateAsync(userId, collectionId, itemId, normalized, timeProvider.GetUtcNow(), parentCommentId, cancellationToken)
            ?? throw new CollectionNotFoundException();
        if (notifications is not null)
        {
            if (created.Comment.ParentCommentId is null)
            {
                // Who the link's owner is (and that it is not the commenter) is decided when the event is processed.
                await notifications.CollectionItemCommentReceivedAsync(userId, collectionId, itemId, cancellationToken);
            }
            else if (created.ReplyToUserId is { } answered && answered != userId)
            {
                await notifications.CommentReplyReceivedAsync(userId, answered, collectionId, itemId, created.Comment.Id, cancellationToken);
            }
        }

        await outbox.CommitAsync(cancellationToken);
        return created.Comment;
    }

    public async Task DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        var access = await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var result = await store.DeleteAsync(userId, collectionId, itemId, commentId, access.IsOwner, timeProvider.GetUtcNow(), cancellationToken)
            ?? throw new CollectionNotFoundException();
        if (result == CommentDeleteResult.NotAllowed)
        {
            throw new CollectionForbiddenException();
        }
    }

    /// <summary>
    /// An edit is not a new event: it tells nobody (no new-comment, no reply notification - not even the answered person
    /// again), and the hearts stay where they are. Only the author may edit, even the Owner cannot edit another's words.
    /// </summary>
    public async Task<CollectionCommentDto> EditAsync(
        long userId, long collectionId, long itemId, long commentId, string? body, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (commentId <= 0)
        {
            throw new InvalidCollectionException("commentId", "commentId must be positive.");
        }

        var normalized = CollectionCommentBody.Normalize(body);
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var outcome = await store.EditAsync(userId, collectionId, itemId, commentId, normalized, cancellationToken)
            ?? throw new CollectionNotFoundException();
        return outcome.Result == CommentEditResult.Edited
            ? outcome.Comment!
            : throw new CollectionForbiddenException();
    }

    public async Task<CommentLikeStateDto> SetLikeAsync(
        long userId, long collectionId, long itemId, long commentId, bool liked, string? unlockToken, CancellationToken cancellationToken = default)
    {
        if (commentId <= 0)
        {
            throw new InvalidCollectionException("commentId", "commentId must be positive.");
        }

        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        await using var outbox = await NotificationOutbox.BeginAsync(notifications, cancellationToken);
        var outcome = await store.SetLikeAsync(userId, collectionId, itemId, commentId, liked, timeProvider.GetUtcNow(), cancellationToken)
            ?? throw new CollectionNotFoundException();
        if (notifications is not null && liked && outcome.Changed && outcome.AuthorUserId is { } author && author != userId)
        {
            await notifications.CommentLikeReceivedAsync(userId, author, collectionId, itemId, commentId, cancellationToken);
        }

        await outbox.CommitAsync(cancellationToken);
        return outcome.State;
    }
}
