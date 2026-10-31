using Juple.Application.Safety;
using Juple.Application.Users.Profile;
using Juple.Domain.Friends;
using Juple.Domain.Safety;
using Juple.Domain.Users;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Safety;

/// <summary>Terms consent, reports and blocks (module "safety", SQL schema <c>safety</c>; the terms columns live on the user row).</summary>
public sealed class SafetyStore(JupleDbContext dbContext, IUserProfileImageStorage? profileImageStorage = null) : ISafetyStore
{
    // ---- terms ----

    public async Task<(string? Version, DateTimeOffset? AcceptedAtUtc)> GetTermsAsync(long userId, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.Users.AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new { user.AcceptedTermsVersion, user.TermsAcceptedAtUtc })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? (null, null) : (row.AcceptedTermsVersion, row.TermsAcceptedAtUtc);
    }

    public async Task<(string Version, DateTimeOffset AcceptedAtUtc)> SetTermsAsync(long userId, string version, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var user = await dbContext.Users.FirstAsync(candidate => candidate.Id == userId, cancellationToken);
        if (user.AcceptedTermsVersion != version || user.TermsAcceptedAtUtc is null)
        {
            user.AcceptTerms(version, nowUtc);
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        return (user.AcceptedTermsVersion!, user.TermsAcceptedAtUtc!.Value);
    }

    // ---- reports ----

    public async Task<ReportTargetResolution> ResolveReportTargetAsync(
        long reporterUserId, ReportTargetType type, string targetId, long? collectionId, CancellationToken cancellationToken = default)
    {
        switch (type)
        {
            case ReportTargetType.User:
                return await ResolveUserAsync(reporterUserId, targetId, cancellationToken);
            case ReportTargetType.Collection:
                return await ResolveCollectionAsync(reporterUserId, long.Parse(targetId, System.Globalization.CultureInfo.InvariantCulture), cancellationToken);
            case ReportTargetType.Item:
                return await ResolveItemAsync(reporterUserId, long.Parse(targetId, System.Globalization.CultureInfo.InvariantCulture), collectionId, cancellationToken);
            case ReportTargetType.Comment:
                return await ResolveCommentAsync(reporterUserId, long.Parse(targetId, System.Globalization.CultureInfo.InvariantCulture), cancellationToken);
            default:
                return ReportTargetResolution.NotFound;
        }
    }

    /// <summary>A person may report someone they can actually see: a friend (or a pending request), or somebody they share a Collection with.</summary>
    private async Task<ReportTargetResolution> ResolveUserAsync(long reporterUserId, string jupleId, CancellationToken cancellationToken)
    {
        if (!UserPublicCode.TryNormalize(jupleId, out var publicCode))
        {
            return ReportTargetResolution.NotFound;
        }

        var targetUserId = await dbContext.Users.AsNoTracking()
            .Where(user => user.PublicCode == publicCode)
            .Select(user => (long?)user.Id)
            .FirstOrDefaultAsync(cancellationToken);
        if (targetUserId is not { } target)
        {
            return ReportTargetResolution.NotFound;
        }

        if (target == reporterUserId)
        {
            return ReportTargetResolution.Own;
        }

        var low = Math.Min(reporterUserId, target);
        var high = Math.Max(reporterUserId, target);
        var related = await dbContext.Friendships.AsNoTracking().AnyAsync(friendship => friendship.UserLowId == low && friendship.UserHighId == high, cancellationToken)
            || await SharesCollectionAsync(reporterUserId, target, cancellationToken);
        return related ? new ReportTargetResolution(ReportTargetOutcome.Found, target, target, null) : ReportTargetResolution.NotFound;
    }

    private async Task<bool> SharesCollectionAsync(long userId, long otherUserId, CancellationToken cancellationToken)
    {
        // Same live Collection: owner + member, or two members.
        var owned = dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null);
        return await owned.AnyAsync(
                collection => (collection.UserId == userId && dbContext.CollectionCollaborators.Any(member => member.CollectionId == collection.Id && member.UserId == otherUserId))
                    || (collection.UserId == otherUserId && dbContext.CollectionCollaborators.Any(member => member.CollectionId == collection.Id && member.UserId == userId)),
                cancellationToken)
            || await dbContext.CollectionCollaborators.AsNoTracking().AnyAsync(
                mine => mine.UserId == userId
                    && dbContext.CollectionCollaborators.Any(theirs => theirs.CollectionId == mine.CollectionId && theirs.UserId == otherUserId)
                    && dbContext.Collections.Any(collection => collection.Id == mine.CollectionId && collection.DeletedAtUtc == null),
                cancellationToken);
    }

    /// <summary>The Collection's owner when the reporter may see the Collection (its owner or an accepted member); null when not.</summary>
    private async Task<long?> VisibleCollectionOwnerAsync(long reporterUserId, long collectionId, CancellationToken cancellationToken)
    {
        var collection = await dbContext.Collections.AsNoTracking()
            .Where(candidate => candidate.Id == collectionId && candidate.DeletedAtUtc == null)
            .Select(candidate => new { candidate.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        if (collection is null)
        {
            return null;
        }

        if (collection.UserId == reporterUserId)
        {
            return collection.UserId;
        }

        // Under an operator's restriction a member no longer sees it: the same answer as a Collection they never had.
        if (await dbContext.ShareRestrictions.AsNoTracking().AnyAsync(
                restriction => restriction.CollectionId == collectionId && restriction.ItemId == null && restriction.LiftedAtUtc == null, cancellationToken))
        {
            return null;
        }

        if (await dbContext.CollectionCollaborators.AsNoTracking().AnyAsync(member => member.CollectionId == collectionId && member.UserId == reporterUserId, cancellationToken))
        {
            return collection.UserId;
        }

        return null;
    }

    private async Task<ReportTargetResolution> ResolveCollectionAsync(long reporterUserId, long collectionId, CancellationToken cancellationToken)
    {
        if (await VisibleCollectionOwnerAsync(reporterUserId, collectionId, cancellationToken) is not { } ownerUserId)
        {
            return ReportTargetResolution.NotFound;
        }

        if (ownerUserId == reporterUserId)
        {
            return ReportTargetResolution.Own;
        }

        var name = await dbContext.Collections.AsNoTracking().Where(collection => collection.Id == collectionId).Select(collection => collection.Name).FirstAsync(cancellationToken);
        return new ReportTargetResolution(ReportTargetOutcome.Found, collectionId, ownerUserId, collectionId, name);
    }

    public async Task<ReportTargetResolution> ResolvePublicShareTargetAsync(long reporterUserId, string publicId, CancellationToken cancellationToken = default)
    {
        var target = await (
            from share in dbContext.CollectionShares.AsNoTracking()
            where share.PublicId == publicId && share.IsActive && share.IsPublic
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null) on share.CollectionId equals collection.Id
            where !dbContext.ShareRestrictions.Any(restriction => restriction.CollectionId == collection.Id && restriction.ItemId == null && restriction.LiftedAtUtc == null)
            select new { collection.Id, collection.UserId, collection.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (target is null)
        {
            return ReportTargetResolution.NotFound;
        }

        return target.UserId == reporterUserId
            ? ReportTargetResolution.Own
            : new ReportTargetResolution(ReportTargetOutcome.Found, target.Id, target.UserId, target.Id, target.Name);
    }

    public async Task<(string Name, long OwnerUserId)?> GetSharedCollectionAsync(long collectionId, CancellationToken cancellationToken = default)
    {
        var row = await dbContext.Collections.AsNoTracking()
            .Where(collection => collection.Id == collectionId && collection.DeletedAtUtc == null
                && (dbContext.CollectionCollaborators.Any(member => member.CollectionId == collection.Id)
                    || dbContext.CollectionShares.Any(share => share.CollectionId == collection.Id && share.IsActive && share.IsPublic)))
            .Select(collection => new { collection.Name, collection.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : (row.Name, row.UserId);
    }

    public async Task<(string? Title, string Url, long OwnerUserId)?> GetSharedLinkAsync(long collectionId, long itemId, CancellationToken cancellationToken = default)
    {
        if (await GetSharedCollectionAsync(collectionId, cancellationToken) is null)
        {
            return null;
        }

        var row = await dbContext.Items.AsNoTracking()
            .Where(item => item.Id == itemId && item.DeletedAtUtc == null
                && dbContext.CollectionItems.Any(membership => membership.CollectionId == collectionId && membership.ItemId == itemId))
            .Select(item => new { item.Title, item.Url, item.UserId })
            .FirstOrDefaultAsync(cancellationToken);
        return row is null ? null : (row.Title, row.Url, row.UserId);
    }

    public async Task AddAutoFilterReportAsync(ContentReport report, CancellationToken cancellationToken = default)
    {
        if (await dbContext.ContentReports.AsNoTracking().AnyAsync(
                candidate => candidate.Source == ReportSource.AutoFilter && candidate.TargetType == report.TargetType && candidate.TargetId == report.TargetId
                    && (candidate.Status == ReportStatus.Pending || candidate.Status == ReportStatus.InReview),
                cancellationToken))
        {
            return;
        }

        dbContext.ContentReports.Add(report);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>An Item is reported through a Collection the reporter can see and that really holds it - never by a bare id.</summary>
    private async Task<ReportTargetResolution> ResolveItemAsync(long reporterUserId, long itemId, long? collectionId, CancellationToken cancellationToken)
    {
        if (collectionId is not { } viaCollection
            || await VisibleCollectionOwnerAsync(reporterUserId, viaCollection, cancellationToken) is null)
        {
            return ReportTargetResolution.NotFound;
        }

        var item = await dbContext.Items.AsNoTracking()
            .Where(candidate => candidate.Id == itemId && candidate.DeletedAtUtc == null
                && dbContext.CollectionItems.Any(membership => membership.CollectionId == viaCollection && membership.ItemId == itemId))
            .Select(candidate => new { candidate.UserId, candidate.Title, candidate.Url })
            .FirstOrDefaultAsync(cancellationToken);
        if (item is null)
        {
            return ReportTargetResolution.NotFound;
        }

        return item.UserId == reporterUserId
            ? ReportTargetResolution.Own
            : new ReportTargetResolution(ReportTargetOutcome.Found, itemId, item.UserId, viaCollection, item.Title, item.Url);
    }

    private async Task<ReportTargetResolution> ResolveCommentAsync(long reporterUserId, long commentId, CancellationToken cancellationToken)
    {
        var comment = await dbContext.CollectionItemComments.AsNoTracking()
            .Where(candidate => candidate.Id == commentId && candidate.DeletedAtUtc == null && candidate.UserId != null)
            .Select(candidate => new { candidate.CollectionId, candidate.UserId, candidate.Body })
            .FirstOrDefaultAsync(cancellationToken);
        if (comment is null || await VisibleCollectionOwnerAsync(reporterUserId, comment.CollectionId, cancellationToken) is null)
        {
            return ReportTargetResolution.NotFound;
        }

        return comment.UserId == reporterUserId
            ? ReportTargetResolution.Own
            : new ReportTargetResolution(ReportTargetOutcome.Found, commentId, comment.UserId, comment.CollectionId, comment.Body);
    }

    public async Task<bool> TryCreateReportAsync(ContentReport report, CancellationToken cancellationToken = default)
    {
        var existing = await dbContext.ContentReports.AsNoTracking().AnyAsync(
            candidate => candidate.ReporterUserId == report.ReporterUserId && candidate.TargetType == report.TargetType
                && candidate.TargetId == report.TargetId
                && (candidate.Status == ReportStatus.Pending || candidate.Status == ReportStatus.InReview),
            cancellationToken);
        if (existing)
        {
            return false;
        }

        dbContext.ContentReports.Add(report);
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent identical report won the race: this one is the same open report.
            dbContext.ChangeTracker.Clear();
            return false;
        }
    }

    // ---- blocks ----

    public async Task<bool> AddBlockAsync(long blockerUserId, long blockedUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var created = false;
        if (!await dbContext.UserBlocks.AnyAsync(block => block.BlockerUserId == blockerUserId && block.BlockedUserId == blockedUserId, cancellationToken))
        {
            dbContext.UserBlocks.Add(new UserBlock(blockerUserId, blockedUserId, nowUtc));
            try
            {
                await dbContext.SaveChangesAsync(cancellationToken);
                created = true;
            }
            catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
            {
                dbContext.ChangeTracker.Clear();
            }
        }

        // A block ends a friendship and a pending friend request between the two (with both private notes); Collections are untouched.
        var low = Math.Min(blockerUserId, blockedUserId);
        var high = Math.Max(blockerUserId, blockedUserId);
        var friendshipIds = await dbContext.Friendships.Where(friendship => friendship.UserLowId == low && friendship.UserHighId == high)
            .Select(friendship => friendship.Id).ToListAsync(cancellationToken);
        if (friendshipIds.Count > 0)
        {
            await dbContext.FriendshipNotes.Where(note => friendshipIds.Contains(note.FriendshipId)).ExecuteDeleteAsync(cancellationToken);
            await dbContext.Friendships.Where(friendship => friendshipIds.Contains(friendship.Id)).ExecuteDeleteAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return created;
    }

    public async Task<bool> RemoveBlockAsync(long blockerUserId, long blockedUserId, CancellationToken cancellationToken = default) =>
        await dbContext.UserBlocks.Where(block => block.BlockerUserId == blockerUserId && block.BlockedUserId == blockedUserId)
            .ExecuteDeleteAsync(cancellationToken) > 0;

    public async Task<IReadOnlyList<BlockedUserDto>> ListBlockedAsync(long blockerUserId, int limit, CancellationToken cancellationToken = default)
    {
        var rows = await (
            from block in dbContext.UserBlocks.AsNoTracking()
            join user in dbContext.Users.AsNoTracking() on block.BlockedUserId equals user.Id
            where block.BlockerUserId == blockerUserId
            orderby block.Id descending
            select new { block.CreatedAtUtc, user.Id, user.PublicCode, user.DisplayName, user.ProfileImageBlobName })
            .Take(limit)
            .ToListAsync(cancellationToken);
        var ownerIds = rows.Select(row => row.Id).ToList();
        var hidden = await (
            from member in dbContext.CollectionCollaborators.AsNoTracking()
            where member.UserId == blockerUserId
            join collection in dbContext.Collections.AsNoTracking().Where(collection => collection.DeletedAtUtc == null) on member.CollectionId equals collection.Id
            where ownerIds.Contains(collection.UserId)
                && !dbContext.ShareRestrictions.Any(restriction => restriction.CollectionId == collection.Id && restriction.ItemId == null && restriction.LiftedAtUtc == null)
            select new { collection.Id, collection.Name, OwnerUserId = collection.UserId })
            .ToListAsync(cancellationToken);
        var result = new List<BlockedUserDto>(rows.Count);
        foreach (var row in rows)
        {
            var image = await profileImageStorage.ResolveProfileImageAsync(row.Id, row.ProfileImageBlobName, cancellationToken);
            result.Add(new BlockedUserDto(row.PublicCode, row.DisplayName, row.CreatedAtUtc, image.Url, image.Version)
            {
                HiddenCollections = hidden.Where(collection => collection.OwnerUserId == row.Id).Select(collection => new BlockedUserHiddenCollectionDto(collection.Id, collection.Name)).ToList(),
            });
        }

        return result;
    }

    public async Task<(bool ByUser, bool ByOther)> GetBlockDirectionsAsync(long userId, long otherUserId, CancellationToken cancellationToken = default)
    {
        var rows = await dbContext.UserBlocks.AsNoTracking()
            .Where(block => (block.BlockerUserId == userId && block.BlockedUserId == otherUserId) || (block.BlockerUserId == otherUserId && block.BlockedUserId == userId))
            .Select(block => block.BlockerUserId)
            .ToListAsync(cancellationToken);
        return (rows.Contains(userId), rows.Contains(otherUserId));
    }

    public async Task<IReadOnlySet<long>> GetBlockedUserIdsAsync(long blockerUserId, CancellationToken cancellationToken = default) =>
        (await dbContext.UserBlocks.AsNoTracking().Where(block => block.BlockerUserId == blockerUserId).Select(block => block.BlockedUserId).ToListAsync(cancellationToken))
        .ToHashSet();
}
