using Juple.Application.Collections.Comments;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionItemCommentStore(JupleDbContext dbContext, IUserProfileImageStorage? profileImageStorage = null) : ICollectionItemCommentStore
{
    /// <summary>Safety bound on how far up a chain of replies the cleanup of finished placeholders walks.</summary>
    private const int MaxCleanupDepth = 1000;

    private static readonly CollectionCommentAuthorDto DeletedAuthor = new(string.Empty, null, null, null, false, false);

    public async Task<CollectionCommentPageDto?> GetPageAsync(
        long userId, long collectionId, long itemId, long? beforeId, int limit, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var comments = dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.CollectionId == collectionId && comment.ItemId == itemId);
        // Every LIVE comment of the link, replies included (a placeholder is not a comment anybody wrote).
        var totalCount = await comments.CountAsync(comment => comment.DeletedAtUtc == null, cancellationToken);
        if (totalCount == 0)
        {
            return new CollectionCommentPageDto([], null, 0);
        }

        // The newest page of TOP-LEVEL comments (or the one before beforeId), read newest first and turned oldest first: one
        // extra row says whether there is an older page. Id is the creation order, so it is the cursor. Each row carries its
        // reply count and hearts from the same statement - never a query per comment.
        var rows = await comments
            .Where(comment => comment.RootCommentId == null && (beforeId == null || comment.Id < beforeId))
            .OrderByDescending(comment => comment.Id)
            .Take(limit + 1)
            .Select(comment => new CommentRow(
                comment.Id,
                comment.Body,
                comment.CreatedAtUtc,
                comment.UserId,
                comment.RootCommentId,
                comment.ParentCommentId,
                comment.ReplyToUserId,
                comment.DeletedAtUtc != null,
                dbContext.CollectionItemComments.Count(reply => reply.RootCommentId == comment.Id),
                dbContext.CollectionItemCommentLikes.Count(like => like.CommentId == comment.Id),
                dbContext.CollectionItemCommentLikes.Any(like => like.CommentId == comment.Id && like.UserId == userId)))
            .ToListAsync(cancellationToken);
        var hasOlder = rows.Count > limit;
        var page = rows.Take(limit).Reverse().ToList();

        var items = await ToDtosAsync(userId, collectionId, page, cancellationToken);
        return new CollectionCommentPageDto(items, hasOlder && page.Count > 0 ? page[0].Id : null, totalCount);
    }

    public async Task<CollectionCommentReplyPageDto?> GetRepliesAsync(
        long userId, long collectionId, long itemId, long rootCommentId, long? afterId, int limit, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var replies = dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.CollectionId == collectionId && comment.ItemId == itemId && comment.RootCommentId == rootCommentId);
        var rootExists = await dbContext.CollectionItemComments.AsNoTracking()
            .AnyAsync(comment => comment.Id == rootCommentId && comment.CollectionId == collectionId && comment.ItemId == itemId && comment.RootCommentId == null, cancellationToken);
        if (!rootExists)
        {
            return null;
        }

        var totalCount = await replies.CountAsync(cancellationToken);
        var rows = await replies
            .Where(comment => afterId == null || comment.Id > afterId)
            .OrderBy(comment => comment.Id)
            .Take(limit + 1)
            .Select(comment => new CommentRow(
                comment.Id,
                comment.Body,
                comment.CreatedAtUtc,
                comment.UserId,
                comment.RootCommentId,
                comment.ParentCommentId,
                comment.ReplyToUserId,
                comment.DeletedAtUtc != null,
                0,
                dbContext.CollectionItemCommentLikes.Count(like => like.CommentId == comment.Id),
                dbContext.CollectionItemCommentLikes.Any(like => like.CommentId == comment.Id && like.UserId == userId)))
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = rows.Take(limit).ToList();

        var items = await ToDtosAsync(userId, collectionId, page, cancellationToken);
        return new CollectionCommentReplyPageDto(items, hasMore && page.Count > 0 ? page[^1].Id : null, totalCount);
    }

    public async Task<CollectionCommentCreated?> CreateAsync(
        long userId, long collectionId, long itemId, string body, DateTimeOffset nowUtc, long? parentCommentId = null, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        CollectionItemComment comment;
        if (parentCommentId is { } parentId)
        {
            // The answered comment must be a live one of THIS link - another link's, a deleted one or a missing one is simply not there.
            // The thread root and the answered person come from it, never from the caller.
            var parent = await dbContext.CollectionItemComments.AsNoTracking()
                .FirstOrDefaultAsync(entry => entry.Id == parentId && entry.CollectionId == collectionId && entry.ItemId == itemId && entry.DeletedAtUtc == null, cancellationToken);
            if (parent is null)
            {
                return null;
            }

            comment = new CollectionItemComment(parent, userId, body, nowUtc);
        }
        else
        {
            comment = new CollectionItemComment(collectionId, itemId, userId, body, nowUtc);
        }

        dbContext.CollectionItemComments.Add(comment);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 547 })
        {
            // The link left the Collection (or the answered comment was deleted) between the check and the write.
            dbContext.Entry(comment).State = EntityState.Detached;
            return null;
        }

        var authors = await ResolveAuthorsAsync(userId, collectionId, [userId], cancellationToken);
        var dto = new CollectionCommentDto(
            comment.Id, comment.Body, comment.CreatedAtUtc, authors[userId], comment.RootCommentId, comment.ParentCommentId,
            ReplyTo: await ReplyTargetAsync(comment.RootCommentId, comment.ParentCommentId, comment.ReplyToUserId, cancellationToken));
        return new CollectionCommentCreated(dto, comment.ReplyToUserId);
    }

    public async Task<CommentDeleteResult?> DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, bool isOwner, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var target = await dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.Id == commentId && comment.CollectionId == collectionId && comment.ItemId == itemId)
            .Select(comment => new { comment.UserId, comment.ParentCommentId, IsPlaceholder = comment.DeletedAtUtc != null })
            .FirstOrDefaultAsync(cancellationToken);
        // Gone, or already only a placeholder: the wanted end state.
        if (target is null || target.IsPlaceholder)
        {
            return CommentDeleteResult.Absent;
        }

        if (!isOwner && target.UserId != userId)
        {
            return CommentDeleteResult.NotAllowed;
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var answered = await IsAnsweredAsync(commentId, cancellationToken);
        var removed = false;
        if (!answered)
        {
            try
            {
                removed = await dbContext.CollectionItemComments
                    .Where(comment => comment.Id == commentId && comment.CollectionId == collectionId && comment.ItemId == itemId)
                    .ExecuteDeleteAsync(cancellationToken) > 0;
            }
            catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 547 })
            {
                // A reply arrived just now: it is answered after all - keep the thread by tombstoning.
                answered = true;
            }
            catch (Microsoft.Data.SqlClient.SqlException exception) when (exception.Number == 547)
            {
                answered = true;
            }
        }

        if (answered)
        {
            // Others replied: the words and the person go, the thread stays. Its hearts go with the words.
            await dbContext.CollectionItemCommentLikes.Where(like => like.CommentId == commentId).ExecuteDeleteAsync(cancellationToken);
            await dbContext.CollectionItemComments
                .Where(comment => comment.Id == commentId && comment.DeletedAtUtc == null)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(comment => comment.Body, string.Empty)
                        .SetProperty(comment => comment.UserId, (long?)null)
                        .SetProperty(comment => comment.DeletedAtUtc, nowUtc),
                    cancellationToken);
        }
        else if (removed)
        {
            await RemoveFinishedPlaceholdersAsync(target.ParentCommentId, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return CommentDeleteResult.Deleted;
    }

    public async Task<CommentLikeOutcome?> SetLikeAsync(
        long userId, long collectionId, long itemId, long commentId, bool liked, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        // Only a live comment of THIS link can be hearted - not a placeholder, not another link's.
        var author = await dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.Id == commentId && comment.CollectionId == collectionId && comment.ItemId == itemId && comment.DeletedAtUtc == null)
            .Select(comment => new { comment.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        if (author is null)
        {
            return null;
        }

        var changed = false;
        if (liked)
        {
            if (!await dbContext.CollectionItemCommentLikes.AnyAsync(like => like.CommentId == commentId && like.UserId == userId, cancellationToken))
            {
                var like = new CollectionItemCommentLike(commentId, userId, nowUtc);
                dbContext.CollectionItemCommentLikes.Add(like);
                try
                {
                    await dbContext.SaveChangesAsync(cancellationToken);
                    changed = true;
                }
                catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
                {
                    // A parallel request of the same person got in first: the heart exists - exactly as asked, nothing changed here.
                    dbContext.Entry(like).State = EntityState.Detached;
                }
                catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 547 })
                {
                    // The comment was deleted between the check and the write.
                    dbContext.Entry(like).State = EntityState.Detached;
                    return null;
                }
            }
        }
        else
        {
            changed = await dbContext.CollectionItemCommentLikes
                .Where(like => like.CommentId == commentId && like.UserId == userId)
                .ExecuteDeleteAsync(cancellationToken) > 0;
        }

        var count = await dbContext.CollectionItemCommentLikes.AsNoTracking().CountAsync(like => like.CommentId == commentId, cancellationToken);
        return new CommentLikeOutcome(new CommentLikeStateDto(liked, count), changed, author.UserId);
    }

    private Task<bool> IsAnsweredAsync(long commentId, CancellationToken cancellationToken) =>
        dbContext.CollectionItemComments.AsNoTracking().AnyAsync(comment => comment.ParentCommentId == commentId, cancellationToken);

    /// <summary>
    /// After a reply was removed for good: the comment it answered, if that is only a placeholder nobody answers any more, is
    /// removed too - and so on up the chain. A live comment is never touched.
    /// </summary>
    private async Task RemoveFinishedPlaceholdersAsync(long? parentCommentId, CancellationToken cancellationToken)
    {
        var current = parentCommentId;
        for (var depth = 0; current is { } id && depth < MaxCleanupDepth; depth++)
        {
            var placeholder = await dbContext.CollectionItemComments.AsNoTracking()
                .Where(comment => comment.Id == id && comment.DeletedAtUtc != null)
                .Select(comment => new { comment.ParentCommentId })
                .FirstOrDefaultAsync(cancellationToken);
            if (placeholder is null || await IsAnsweredAsync(id, cancellationToken))
            {
                return;
            }

            await dbContext.CollectionItemComments.Where(comment => comment.Id == id && comment.DeletedAtUtc != null).ExecuteDeleteAsync(cancellationToken);
            current = placeholder.ParentCommentId;
        }
    }

    private Task<bool> IsLinkAsync(long collectionId, long itemId, CancellationToken cancellationToken) =>
        (from membership in dbContext.CollectionItems.AsNoTracking()
         where membership.CollectionId == collectionId && membership.ItemId == itemId
         join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null) on membership.ItemId equals item.Id
         select membership.Id).AnyAsync(cancellationToken);

    private sealed record CommentRow(
        long Id,
        string Body,
        DateTimeOffset CreatedAtUtc,
        long? UserId,
        long? RootCommentId,
        long? ParentCommentId,
        long? ReplyToUserId,
        bool IsDeleted,
        int ReplyCount,
        int LikeCount,
        bool ViewerLiked);

    /// <summary>A page of rows as DTOs: the authors in a fixed number of statements, and - only for replies to a reply - the answered people's names.</summary>
    private async Task<IReadOnlyList<CollectionCommentDto>> ToDtosAsync(
        long userId, long collectionId, IReadOnlyList<CommentRow> page, CancellationToken cancellationToken)
    {
        var authors = await ResolveAuthorsAsync(
            userId, collectionId, page.Where(row => row.UserId is not null).Select(row => row.UserId!.Value).Distinct().ToList(), cancellationToken);
        var answeredIds = page
            .Where(row => row.ReplyToUserId is not null && row.ParentCommentId != row.RootCommentId)
            .Select(row => row.ReplyToUserId!.Value)
            .Distinct()
            .ToList();
        var answered = answeredIds.Count == 0
            ? []
            : await dbContext.Users.AsNoTracking()
                .Where(user => answeredIds.Contains(user.Id))
                .Select(user => new { user.Id, user.PublicCode, user.DisplayName })
                .ToDictionaryAsync(user => user.Id, user => new CollectionCommentReplyTargetDto(user.PublicCode, user.DisplayName), cancellationToken);

        return page
            .Select(row => new CollectionCommentDto(
                row.Id,
                row.IsDeleted ? string.Empty : row.Body,
                row.CreatedAtUtc,
                row.UserId is { } authorId && !row.IsDeleted ? authors[authorId] : DeletedAuthor,
                row.RootCommentId,
                row.ParentCommentId,
                row.ReplyToUserId is { } answeredId && row.ParentCommentId != row.RootCommentId ? answered.GetValueOrDefault(answeredId) : null,
                row.ReplyCount,
                row.LikeCount,
                row.ViewerLiked,
                row.IsDeleted))
            .ToList();
    }

    private async Task<CollectionCommentReplyTargetDto?> ReplyTargetAsync(
        long? rootCommentId, long? parentCommentId, long? replyToUserId, CancellationToken cancellationToken)
    {
        // A direct reply is already under its parent; only a reply to another reply names who it answers.
        if (replyToUserId is not { } answeredId || parentCommentId == rootCommentId)
        {
            return null;
        }

        return await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == answeredId)
            .Select(user => new CollectionCommentReplyTargetDto(user.PublicCode, user.DisplayName))
            .FirstOrDefaultAsync(cancellationToken);
    }

    /// <summary>
    /// The page's authors in two statements (the Owner's id, then all the people at once) - never one
    /// per comment - with each distinct author's photo signed once. An author who has left the
    /// Collection is still shown: their comment stays in the conversation.
    /// </summary>
    private async Task<IReadOnlyDictionary<long, CollectionCommentAuthorDto>> ResolveAuthorsAsync(
        long userId, long collectionId, IReadOnlyCollection<long> authorIds, CancellationToken cancellationToken)
    {
        if (authorIds.Count == 0)
        {
            return new Dictionary<long, CollectionCommentAuthorDto>();
        }

        var ownerId = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId)
            .Select(collection => collection.UserId)
            .FirstAsync(cancellationToken);
        var people = await dbContext.Users.AsNoTracking()
            .Where(user => authorIds.Contains(user.Id))
            .Select(user => new { user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
            .ToListAsync(cancellationToken);

        var authors = new Dictionary<long, CollectionCommentAuthorDto>(people.Count);
        foreach (var person in people)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(person.Id, person.ProfileImageBlobName, cancellationToken);
            authors[person.Id] = new CollectionCommentAuthorDto(
                person.PublicCode, person.DisplayName, image.Url, image.Version, person.Id == ownerId, person.Id == userId);
        }

        return authors;
    }
}
