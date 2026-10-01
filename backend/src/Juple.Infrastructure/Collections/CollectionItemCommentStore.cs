using Juple.Application.Collections.Comments;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionItemCommentStore(JupleDbContext dbContext, IUserProfileImageStorage? profileImageStorage = null) : ICollectionItemCommentStore
{
    public async Task<CollectionCommentPageDto?> GetPageAsync(
        long userId, long collectionId, long itemId, long? beforeId, int limit, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var comments = dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.CollectionId == collectionId && comment.ItemId == itemId);
        var totalCount = await comments.CountAsync(cancellationToken);
        if (totalCount == 0)
        {
            return new CollectionCommentPageDto([], null, 0);
        }

        // The newest page (or the one before beforeId), read newest first and turned oldest first: one
        // extra row says whether there is an older page. Id is the creation order, so it is the cursor.
        var rows = await comments
            .Where(comment => beforeId == null || comment.Id < beforeId)
            .OrderByDescending(comment => comment.Id)
            .Take(limit + 1)
            .Select(comment => new { comment.Id, comment.Body, comment.CreatedAtUtc, comment.UserId })
            .ToListAsync(cancellationToken);
        var hasOlder = rows.Count > limit;
        var page = rows.Take(limit).Reverse().ToList();

        var authors = await ResolveAuthorsAsync(userId, collectionId, page.Select(row => row.UserId).Distinct().ToList(), cancellationToken);
        var items = page
            .Select(row => new CollectionCommentDto(row.Id, row.Body, row.CreatedAtUtc, authors[row.UserId]))
            .ToList();
        return new CollectionCommentPageDto(items, hasOlder && page.Count > 0 ? page[0].Id : null, totalCount);
    }

    public async Task<CollectionCommentDto?> CreateAsync(
        long userId, long collectionId, long itemId, string body, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var comment = new CollectionItemComment(collectionId, itemId, userId, body, nowUtc);
        dbContext.CollectionItemComments.Add(comment);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (exception.InnerException is Microsoft.Data.SqlClient.SqlException { Number: 547 })
        {
            // The link left the Collection between the check and the write.
            dbContext.Entry(comment).State = EntityState.Detached;
            return null;
        }

        var authors = await ResolveAuthorsAsync(userId, collectionId, [userId], cancellationToken);
        return new CollectionCommentDto(comment.Id, comment.Body, comment.CreatedAtUtc, authors[userId]);
    }

    public async Task<CommentDeleteResult?> DeleteAsync(
        long userId, long collectionId, long itemId, long commentId, bool isOwner, CancellationToken cancellationToken = default)
    {
        if (!await IsLinkAsync(collectionId, itemId, cancellationToken))
        {
            return null;
        }

        var author = await dbContext.CollectionItemComments.AsNoTracking()
            .Where(comment => comment.Id == commentId && comment.CollectionId == collectionId && comment.ItemId == itemId)
            .Select(comment => (long?)comment.UserId)
            .FirstOrDefaultAsync(cancellationToken);
        if (author is null)
        {
            return CommentDeleteResult.Absent;
        }

        if (!isOwner && author != userId)
        {
            return CommentDeleteResult.NotAllowed;
        }

        await dbContext.CollectionItemComments
            .Where(comment => comment.Id == commentId && comment.CollectionId == collectionId && comment.ItemId == itemId)
            .ExecuteDeleteAsync(cancellationToken);
        return CommentDeleteResult.Deleted;
    }

    private Task<bool> IsLinkAsync(long collectionId, long itemId, CancellationToken cancellationToken) =>
        (from membership in dbContext.CollectionItems.AsNoTracking()
         where membership.CollectionId == collectionId && membership.ItemId == itemId
         join item in dbContext.Items.AsNoTracking().Where(item => item.DeletedAtUtc == null) on membership.ItemId equals item.Id
         select membership.Id).AnyAsync(cancellationToken);

    /// <summary>
    /// The page's authors in two statements (the Owner's id, then all the people at once) - never one
    /// per comment - with each distinct author's photo signed once. An author who has left the
    /// Collection is still shown: their comment stays in the conversation.
    /// </summary>
    private async Task<IReadOnlyDictionary<long, CollectionCommentAuthorDto>> ResolveAuthorsAsync(
        long userId, long collectionId, IReadOnlyCollection<long> authorIds, CancellationToken cancellationToken)
    {
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
