using Juple.Application.Collections;
using Juple.Application.Collections.Public;
using Juple.Application.Collections.Submissions;
using Juple.Application.Items;
using Juple.Application.Users.Profile;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Collections;

public sealed class CollectionLinkSubmissionStore(
    JupleDbContext dbContext,
    IUserProfileImageStorage? profileImageStorage = null) : ICollectionLinkSubmissionStore
{
    // Same spacing as CollectionStore: a new link goes on top of the Collection's manual order.
    private const int SortOrderGap = 4096;

    public async Task<CollectionLinkAddOutcome?> SubmitAsync(
        long userId,
        long collectionId,
        long itemId,
        string? requiredPublicId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken);
        if (ownerUserId is null)
        {
            return null;
        }

        if (requiredPublicId is not null)
        {
            // Under the same lock a revoke or permission change takes: this exact link must still be on
            // and still take proposals.
            var permission = await dbContext.CollectionShares.AsNoTracking()
                .Where(share => share.PublicId == requiredPublicId && share.CollectionId == collectionId && share.IsActive)
                .Select(share => (CollectionSharePermission?)share.Permission)
                .FirstOrDefaultAsync(cancellationToken);
            if (permission is null)
            {
                return null;
            }

            if (permission != CollectionSharePermission.Submit)
            {
                throw new PublicShareReadOnlyException();
            }
        }

        // Only the caller's own, live Item - its shared fields are what the Owner will review.
        var item = await dbContext.Items.AsNoTracking()
            .Where(entry => entry.Id == itemId && entry.UserId == userId && entry.DeletedAtUtc == null)
            .Select(entry => new { entry.Url, entry.Title, entry.PreviewImageUrl })
            .FirstOrDefaultAsync(cancellationToken)
            ?? throw new ItemNotFoundException();

        if (await IsLinkInCollectionAsync(collectionId, item.Url, cancellationToken))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.LinkAlreadyInCollection);
        }

        // The Owner's own link is never a proposal: it goes straight in (as their direct add would).
        if (ownerUserId == userId)
        {
            dbContext.CollectionItems.Add(new CollectionItem(
                collectionId, itemId, userId, nowUtc, await TopSortOrderAsync(collectionId, cancellationToken)));
            await dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);
            return CollectionLinkAddOutcome.Added;
        }

        var urlHash = CollectionLinkSubmission.HashOf(item.Url);
        if (await dbContext.CollectionLinkSubmissions.AnyAsync(
                submission => submission.CollectionId == collectionId && submission.UrlHash == urlHash, cancellationToken))
        {
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.LinkAlreadyPending);
        }

        dbContext.CollectionLinkSubmissions.Add(new CollectionLinkSubmission(
            collectionId, itemId, userId, viaPublicShare: requiredPublicId is not null, item.Url, item.Title, item.PreviewImageUrl, nowUtc));
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // The same link was proposed at the same moment - that one is the proposal.
            throw new CollectionCollaborationConflictException(CollectionCollaborationConflictException.LinkAlreadyPending);
        }

        await transaction.CommitAsync(cancellationToken);
        return CollectionLinkAddOutcome.Submitted;
    }

    public async Task<CollectionLinkSubmissionPage> ListAsync(
        long collectionId,
        long? afterSubmissionId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        var rows = await dbContext.CollectionLinkSubmissions.AsNoTracking()
            .Where(submission => submission.CollectionId == collectionId
                && (afterSubmissionId == null || submission.Id > afterSubmissionId))
            .OrderBy(submission => submission.Id)
            .Take(limit + 1)
            .Select(submission => new
            {
                submission.Id,
                submission.Url,
                submission.Title,
                submission.PreviewImageUrl,
                submission.CreatedAtUtc,
                submission.ViaPublicShare,
                submission.SubmittedByUserId,
            })
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.GetRange(0, limit) : rows;

        // Members' public identity, one query for the page; someone who proposed through the public
        // link is never looked up at all.
        var memberIds = page.Where(row => !row.ViaPublicShare).Select(row => row.SubmittedByUserId).Distinct().ToList();
        var people = memberIds.Count == 0
            ? []
            : await dbContext.Users.AsNoTracking()
                .Where(user => memberIds.Contains(user.Id))
                .Select(user => new { user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
                .ToListAsync(cancellationToken);
        var proposers = new Dictionary<long, CollectionItemAdderDto>();
        foreach (var person in people)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(person.Id, person.ProfileImageBlobName, cancellationToken);
            proposers[person.Id] = new CollectionItemAdderDto(
                CollectionItemAdderKinds.Member, person.PublicCode, person.DisplayName, image.Url, image.Version);
        }

        return new CollectionLinkSubmissionPage(
            page.Select(row => new CollectionLinkSubmissionDto(
                row.Id,
                row.Url,
                row.Title,
                row.PreviewImageUrl,
                row.CreatedAtUtc,
                row.ViaPublicShare,
                row.ViaPublicShare ? null : proposers.GetValueOrDefault(row.SubmittedByUserId))).ToList(),
            hasMore ? page[^1].Id : null);
    }

    // Every proposal the caller still has waiting in a Collection that exists - whether they are a member of it
    // now, proposed through a public link as a non-member, or the link has since been switched off. It never
    // depends on current membership or an enabled link: it is the caller's own request and it must stay findable
    // (and cancellable) so a revoked public link can never trap it.
    public async Task<int> CountMineInSharedCollectionsAsync(long userId, CancellationToken cancellationToken = default) =>
        await (
            from submission in dbContext.CollectionLinkSubmissions.AsNoTracking()
            where submission.SubmittedByUserId == userId
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on submission.CollectionId equals collection.Id
            select submission.Id)
            .CountAsync(cancellationToken);

    public async Task<MyCollectionLinkSubmissionAcrossPage> ListMineAcrossCollectionsAsync(
        long userId,
        long? beforeSubmissionId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        // The caller's own rows in Collections that exist (the same set as the count above). For a Collection
        // they are a member of: its id and name. For one they are NOT (a public-link proposal, a link since
        // revoked, a former member): no id and no name - only the caller's own request and its status, so
        // nothing about the Collection is revealed merely because their proposal exists.
        var mine =
            from submission in dbContext.CollectionLinkSubmissions.AsNoTracking()
            where submission.SubmittedByUserId == userId
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null)
                on submission.CollectionId equals collection.Id
            let isMember = dbContext.CollectionCollaborators.Any(collaborator => collaborator.CollectionId == collection.Id && collaborator.UserId == userId)
            select new
            {
                submission.Id,
                // Only for a member; never for anyone else (see above).
                CollectionId = isMember ? (long?)collection.Id : null,
                CollectionName = isMember ? collection.Name : null,
                submission.Url,
                submission.Title,
                submission.PreviewImageUrl,
                submission.CreatedAtUtc,
            };
        var totalCount = await mine.CountAsync(cancellationToken);
        var rows = await mine
            .Where(row => beforeSubmissionId == null || row.Id < beforeSubmissionId)
            .OrderByDescending(row => row.Id)
            .Take(limit + 1)
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.GetRange(0, limit) : rows;
        return new MyCollectionLinkSubmissionAcrossPage(
            page.Select(row => new MyCollectionLinkSubmissionWithCollectionDto(
                row.Id, row.CollectionId, row.CollectionName, row.Url, row.Title, row.PreviewImageUrl, row.CreatedAtUtc)).ToList(),
            hasMore ? page[^1].Id : null,
            totalCount);
    }

    public async Task<MyCollectionLinkSubmissionPage> ListMineAsync(
        long collectionId,
        long userId,
        long? beforeSubmissionId,
        int limit,
        CancellationToken cancellationToken = default)
    {
        // Indexed queries (CollectionId / SubmittedByUserId): the caller's own rows only, and their count.
        var totalCount = await dbContext.CollectionLinkSubmissions.AsNoTracking()
            .CountAsync(submission => submission.CollectionId == collectionId && submission.SubmittedByUserId == userId, cancellationToken);
        var rows = await dbContext.CollectionLinkSubmissions.AsNoTracking()
            .Where(submission => submission.CollectionId == collectionId
                && submission.SubmittedByUserId == userId
                && (beforeSubmissionId == null || submission.Id < beforeSubmissionId))
            .OrderByDescending(submission => submission.Id)
            .Take(limit + 1)
            .Select(submission => new { submission.Id, submission.Url, submission.Title, submission.PreviewImageUrl, submission.CreatedAtUtc })
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = hasMore ? rows.GetRange(0, limit) : rows;
        return new MyCollectionLinkSubmissionPage(
            page.Select(row => new MyCollectionLinkSubmissionDto(row.Id, row.Url, row.Title, row.PreviewImageUrl, row.CreatedAtUtc)).ToList(),
            hasMore ? page[^1].Id : null,
            totalCount);
    }

    public async Task<ApprovedCollectionLinkSubmission> ApproveAsync(
        long collectionId,
        long submissionId,
        DateTimeOffset nowUtc,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        // Every approve/reject of this Collection's proposals (and every add) serializes here, so the
        // same proposal can never be approved twice.
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId, cancellationToken)
            ?? throw new CollectionNotFoundException();

        var submission = await dbContext.CollectionLinkSubmissions
            .FirstOrDefaultAsync(entry => entry.Id == submissionId && entry.CollectionId == collectionId, cancellationToken)
            ?? throw new CollectionLinkSubmissionNotFoundException();

        var item = await dbContext.Items.AsNoTracking()
            .Where(entry => entry.Id == submission.ItemId && entry.UserId == submission.SubmittedByUserId && entry.DeletedAtUtc == null)
            .Select(entry => new { entry.Url })
            .FirstOrDefaultAsync(cancellationToken);
        var conflict = item is null
            ? CollectionCollaborationConflictException.SubmissionUnavailable
            : await IsLinkInCollectionAsync(collectionId, item.Url, cancellationToken)
                ? CollectionCollaborationConflictException.LinkAlreadyInCollection
                : null;

        dbContext.CollectionLinkSubmissions.Remove(submission);
        if (conflict is null)
        {
            dbContext.CollectionItems.Add(new CollectionItem(
                collectionId,
                submission.ItemId,
                submission.SubmittedByUserId,
                nowUtc,
                await TopSortOrderAsync(collectionId, cancellationToken),
                addedViaPublicShare: submission.ViaPublicShare));
        }

        await dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        if (conflict is not null)
        {
            // Nothing to add any more - the proposal is cleared rather than left to fail again.
            throw new CollectionCollaborationConflictException(conflict);
        }

        return new ApprovedCollectionLinkSubmission(collectionId, ownerUserId, submission.SubmittedByUserId, submission.ViaPublicShare, submission.ItemId);
    }

    public async Task<CancelledCollectionLinkSubmission?> CancelMineAsync(
        long userId,
        long submissionId,
        long? requiredCollectionId,
        CancellationToken cancellationToken = default)
    {
        // Which Collection to lock - read only for the caller's own row, so another user's id reveals nothing.
        var collectionId = await dbContext.CollectionLinkSubmissions.AsNoTracking()
            .Where(entry => entry.Id == submissionId && entry.SubmittedByUserId == userId
                && (requiredCollectionId == null || entry.CollectionId == requiredCollectionId))
            .Select(entry => (long?)entry.CollectionId)
            .FirstOrDefaultAsync(cancellationToken);
        if (collectionId is null)
        {
            return null;
        }

        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        // The lock approve takes: cancel and approve of this Collection's proposals are strictly ordered.
        var ownerUserId = await CollectionRowLock.LockActiveAsync(dbContext, collectionId.Value, cancellationToken);
        if (ownerUserId is null)
        {
            return null;
        }

        // The conditional delete is the transition: only the one that removes the row wins, and a
        // proposal already approved or rejected is simply not there (never resurrected, never duplicated).
        var deleted = await dbContext.CollectionLinkSubmissions
            .Where(entry => entry.Id == submissionId && entry.SubmittedByUserId == userId && entry.CollectionId == collectionId)
            .ExecuteDeleteAsync(cancellationToken);
        if (deleted == 0)
        {
            return null;
        }

        // Exactly this proposal's notification (its SubjectId IS the proposal id) - never the others of
        // the Collection. Push deliveries go with it (cascade), and a queued/recovered Push for it finds
        // neither the notification nor the proposal and is skipped.
        await dbContext.Notifications
            .Where(notification => notification.Type == NotificationType.CollectionLinkSubmissionReceived
                && notification.SubjectId == submissionId
                && notification.CollectionId == collectionId)
            .ExecuteDeleteAsync(cancellationToken);

        await transaction.CommitAsync(cancellationToken);
        return new CancelledCollectionLinkSubmission(collectionId.Value, ownerUserId.Value);
    }

    public async Task<RejectedCollectionLinkSubmission?> RejectAsync(long collectionId, long submissionId, CancellationToken cancellationToken = default)
    {
        var rejected = await dbContext.CollectionLinkSubmissions.AsNoTracking()
            .Where(entry => entry.Id == submissionId && entry.CollectionId == collectionId)
            .Select(entry => new RejectedCollectionLinkSubmission(entry.SubmittedByUserId, entry.ItemId))
            .FirstOrDefaultAsync(cancellationToken);
        if (rejected is null)
        {
            return null;
        }

        // Only the delete that actually removed it counts - a concurrent approve or reject that got
        // there first leaves nothing to delete, and this reject is then not a result to report.
        var deleted = await dbContext.CollectionLinkSubmissions
            .Where(entry => entry.Id == submissionId && entry.CollectionId == collectionId)
            .ExecuteDeleteAsync(cancellationToken);
        return deleted > 0 ? rejected : null;
    }

    /// <summary>The same link = the same exact URL among the Collection's live links (the rule copying uses).</summary>
    private Task<bool> IsLinkInCollectionAsync(long collectionId, string url, CancellationToken cancellationToken) =>
        (from membership in dbContext.CollectionItems
         where membership.CollectionId == collectionId
         join linked in dbContext.Items on membership.ItemId equals linked.Id
         where linked.DeletedAtUtc == null && linked.Url == url
         select membership.Id).AnyAsync(cancellationToken);

    private async Task<int> TopSortOrderAsync(long collectionId, CancellationToken cancellationToken)
    {
        var minSortOrder = await dbContext.CollectionItems
            .Where(membership => membership.CollectionId == collectionId)
            .Select(membership => (int?)membership.SortOrder)
            .MinAsync(cancellationToken);
        return minSortOrder is { } existingMin ? existingMin - SortOrderGap : 0;
    }
}
