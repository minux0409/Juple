using Juple.Application.Collections.Access;

namespace Juple.Application.Collections.Comments;

/// <summary>Who wrote a comment, as the Collection's own people may see them (the same identity the participant list shows).</summary>
public sealed record CollectionCommentAuthorDto(
    string JupleId,
    string? DisplayName,
    string? ProfileImageUrl,
    string? ProfileImageVersion,
    bool IsCollectionOwner,
    bool IsMe);

public sealed record CollectionCommentDto(long Id, string Body, DateTimeOffset CreatedAtUtc, CollectionCommentAuthorDto Author);

/// <summary>
/// One page of a link's comments, oldest first. PreviousCursor is the id to pass as "before" for the
/// next older page (null when this page starts at the oldest comment); TotalCount is every comment
/// on the link.
/// </summary>
public sealed record CollectionCommentPageDto(IReadOnlyList<CollectionCommentDto> Items, long? PreviousCursor, int TotalCount);

public enum CommentDeleteResult
{
    Deleted,

    /// <summary>It is gone already - the wanted end state.</summary>
    Absent,

    /// <summary>It is somebody else's and the caller is not the Owner.</summary>
    NotAllowed,
}

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
    /// The newest `limit` comments older than beforeId (null = the newest of all), returned oldest
    /// first, with their authors in one batch (each distinct author's profile photo is signed once).
    /// Null when the Item is not a link of the Collection (or is in the trash).
    /// </summary>
    Task<CollectionCommentPageDto?> GetPageAsync(
        long userId, long collectionId, long itemId, long? beforeId, int limit, CancellationToken cancellationToken = default);

    /// <summary>Adds the comment as the caller's; null when the Item is not a link of the Collection.</summary>
    Task<CollectionCommentDto?> CreateAsync(
        long userId, long collectionId, long itemId, string body, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Hard-deletes it when the caller wrote it or isOwner; null when the Item is not a link of the Collection.</summary>
    Task<CommentDeleteResult?> DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, bool isOwner, CancellationToken cancellationToken = default);
}

public interface ICollectionItemCommentService
{
    Task<CollectionCommentPageDto> ListAsync(
        long userId, long collectionId, long itemId, long? beforeId, int? limit, string? unlockToken, CancellationToken cancellationToken = default);

    Task<CollectionCommentDto> CreateAsync(
        long userId, long collectionId, long itemId, string? body, string? unlockToken, CancellationToken cancellationToken = default);

    Task DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, string? unlockToken, CancellationToken cancellationToken = default);
}

/// <summary>
/// Comments are for the Collection's people only: the Owner and accepted members of any role. Anyone
/// else - a pending invitee, a non-member, a holder of the public link - is told the Collection does
/// not exist. The same content gate as reading the links applies (a lock or share password needs its
/// grant first, the Owner included). Writing a comment does not make a link or change the Collection,
/// so a Viewer may comment. The Owner may delete any comment; everyone else only their own.
/// </summary>
public sealed class CollectionItemCommentService(
    ICollectionAccessService accessService,
    ICollectionItemCommentStore store,
    TimeProvider timeProvider) : ICollectionItemCommentService
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

    public async Task<CollectionCommentDto> CreateAsync(
        long userId, long collectionId, long itemId, string? body, string? unlockToken, CancellationToken cancellationToken = default)
    {
        var normalized = CollectionCommentBody.Normalize(body);
        await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        return await store.CreateAsync(userId, collectionId, itemId, normalized, timeProvider.GetUtcNow(), cancellationToken)
            ?? throw new CollectionNotFoundException();
    }

    public async Task DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, string? unlockToken, CancellationToken cancellationToken = default)
    {
        var access = await accessService.RequireContentAsync(userId, collectionId, unlockToken, cancellationToken);
        var result = await store.DeleteAsync(userId, collectionId, itemId, commentId, access.IsOwner, cancellationToken)
            ?? throw new CollectionNotFoundException();
        if (result == CommentDeleteResult.NotAllowed)
        {
            throw new CollectionForbiddenException();
        }
    }
}
