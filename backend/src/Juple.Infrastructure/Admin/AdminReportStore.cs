using System.Globalization;
using Juple.Application.Admin;
using Juple.Domain.Admin;
using Juple.Domain.Collections;
using Juple.Domain.Notifications;
using Juple.Domain.Safety;
using Juple.Infrastructure.Persistence;
using Juple.Infrastructure.Persistence.SqlServer;
using Microsoft.EntityFrameworkCore;

namespace Juple.Infrastructure.Admin;

public sealed class AdminReportStore(JupleDbContext dbContext) : IAdminReportStore
{
    private const int PriorLimit = 20;
    private const int HistoryLimit = 50;

    public async Task<AdminReportPage> ListAsync(IReadOnlyCollection<ReportStatus> statuses, long? cursor, int limit, CancellationToken cancellationToken = default)
    {
        var query = dbContext.ContentReports.AsNoTracking().Where(report => statuses.Contains(report.Status));
        if (cursor is { } before)
        {
            query = query.Where(report => report.Id < before);
        }

        var rows = await query
            .OrderByDescending(report => report.Id)
            .Take(limit + 1)
            .Select(report => new
            {
                report.Id,
                report.CreatedAtUtc,
                report.TargetType,
                report.TargetId,
                report.CollectionId,
                report.SnapshotTitle,
                report.Reason,
                report.Status,
                report.Source,
                report.ReporterUserId,
                Reporter = dbContext.Users.Where(user => user.Id == report.ReporterUserId)
                    .Select(user => new AdminInquiryPerson(user.Id, user.PublicCode, user.DisplayName)).FirstOrDefault(),
                HasRestriction = dbContext.ShareRestrictions.Any(restriction => restriction.ReportId == report.Id),
            })
            .ToListAsync(cancellationToken);
        var hasMore = rows.Count > limit;
        var page = rows.Take(limit).ToList();
        return new AdminReportPage(
            page.Select(row => new AdminReportListItem(
                row.Id, row.CreatedAtUtc, row.TargetType.ToString(), row.TargetId, row.CollectionId, row.SnapshotTitle, row.Reason.ToString(), row.Status.ToString(), row.Source.ToString(),
                row.Reporter, row.HasRestriction || row.Status == ReportStatus.Actioned)).ToList(),
            hasMore ? page[^1].Id : null);
    }

    public async Task<AdminReportDetail?> GetAsync(long reportId, CancellationToken cancellationToken = default)
    {
        var report = await dbContext.ContentReports.AsNoTracking().FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return null;
        }

        var (exists, title, url) = await CurrentTargetAsync(report, cancellationToken);
        var active = await ActiveRestrictionQuery(report).AsNoTracking().FirstOrDefaultAsync(cancellationToken);
        var prior = await dbContext.ContentReports.AsNoTracking()
            .Where(other => other.TargetType == report.TargetType && other.TargetId == report.TargetId && other.Id != report.Id)
            .OrderByDescending(other => other.Id)
            .Take(PriorLimit)
            .Select(other => new { other.Id, other.CreatedAtUtc, other.Reason, other.Status, other.Source })
            .ToListAsync(cancellationToken);
        var targetId = report.Id.ToString(CultureInfo.InvariantCulture);
        var history = await (
            from log in dbContext.AdminAuditLogs.AsNoTracking()
            where log.TargetType == AdminAuditTargets.ContentReport && log.TargetId == targetId
            orderby log.Id descending
            select new AdminAuditEntry(
                log.AdminUserId,
                dbContext.Users.Where(user => user.Id == log.AdminUserId).Select(user => user.PublicCode).FirstOrDefault(),
                log.Action,
                log.Detail,
                log.CreatedAtUtc))
            .Take(HistoryLimit)
            .ToListAsync(cancellationToken);

        var targetUserId = report.TargetUserId;
        var warning = await dbContext.ModerationNotices.AsNoTracking()
            .Where(notice => notice.ReportId == report.Id && notice.Kind == ModerationNoticeKind.Warning)
            .Select(notice => new { notice.CreatedAtUtc, notice.AcknowledgedAtUtc })
            .FirstOrDefaultAsync(cancellationToken);
        var targetIsOperator = targetUserId is { } operatorCheck && await dbContext.AdminUsers.AsNoTracking().AnyAsync(admin => admin.UserId == operatorCheck && admin.IsActive, cancellationToken);
        var targetRestricted = targetUserId is { } restrictedCheck && await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == restrictedCheck && user.UsageRestrictedAtUtc != null, cancellationToken);
        var targetDeleted = CanDelete(report) && !exists;
        var noticeRows = await dbContext.ModerationNotices.AsNoTracking()
            .Where(notice => notice.ReportId == report.Id && notice.Kind != ModerationNoticeKind.ReportResult)
            .OrderBy(notice => notice.Id)
            .Select(notice => new { notice.Id, notice.Kind, notice.ActionType, notice.CreatedAtUtc, notice.AcknowledgedAtUtc, notice.Guidance })
            .ToListAsync(cancellationToken);
        var notices = noticeRows
            .Select(row => new AdminReportNoticeEntry(
                row.Id, row.Kind == ModerationNoticeKind.Warning ? "warning" : "action", row.ActionType?.ToString(), row.CreatedAtUtc, row.AcknowledgedAtUtc, row.Guidance))
            .ToList();
        var collection = report.CollectionId is { } collectionId
            ? await dbContext.Collections.AsNoTracking().Where(candidate => candidate.Id == collectionId)
                .Select(candidate => new { candidate.Name, Deleted = candidate.DeletedAtUtc != null }).FirstOrDefaultAsync(cancellationToken)
            : null;

        return new AdminReportDetail(
            report.Id, report.CreatedAtUtc, report.TargetType.ToString(), report.TargetId, report.CollectionId, report.Reason.ToString(), report.Details,
            report.Status.ToString(), report.Source.ToString(),
            await PersonAsync(report.ReporterUserId, cancellationToken),
            await PersonAsync(report.TargetUserId, cancellationToken),
            report.SnapshotTitle, report.SnapshotUrl, title, url, exists,
            CanRestrict(report), active is not null, active?.RestrictedAtUtc,
            report.ReviewedAtUtc,
            await PersonAsync(report.ReviewedByAdminUserId, cancellationToken),
            report.Resolution,
            prior.Select(other => new AdminReportPriorEntry(other.Id, other.CreatedAtUtc, other.Reason.ToString(), other.Status.ToString(), other.Source.ToString())).ToList(),
            history)
        {
            CanWarn = targetUserId is not null && !targetIsOperator,
            WarningSentAtUtc = warning?.CreatedAtUtc,
            WarningAcknowledged = warning?.AcknowledgedAtUtc is not null,
            CanDeleteTarget = CanDelete(report),
            TargetDeleted = targetDeleted,
            CanRestrictAccount = targetUserId is not null && !targetIsOperator,
            TargetAccountRestricted = targetRestricted,
            Notices = notices,
            CollectionName = collection?.Name,
            CollectionDeleted = collection?.Deleted ?? false,
        };
    }

    public async Task<bool> ChangeStatusAsync(long reportId, ReportStatus status, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        // "Nothing wrong" cannot stand next to a restriction in force on the same thing: lift it first.
        if (status == ReportStatus.Dismissed && await ActiveRestrictionQuery(report).AnyAsync(cancellationToken))
        {
            throw new AdminReportConflictException(AdminReportConflictException.RestrictionActive);
        }

        var previous = report.Status;
        report.Review(status, adminUserId, note, nowUtc);
        Audit(adminUserId, AdminAuditActions.ReportStatusChanged, reportId, $"{previous}->{status}", nowUtc);
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        await SaveAsync(cancellationToken);

        // The REPORTER hears that it was reviewed (never what was decided about the other person): once per report, only for a person's own
        // report whose account still exists, and only when the report is decided (Dismissed / Actioned).
        if (status is ReportStatus.Dismissed or ReportStatus.Actioned
            && report.Source == ReportSource.User
            && report.ReporterUserId is { } reporterId
            && await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == reporterId, cancellationToken)
            && !await dbContext.ModerationNotices.AnyAsync(
                notice => notice.ReportId == report.Id && notice.RecipientUserId == reporterId && notice.Kind == ModerationNoticeKind.ReportResult, cancellationToken))
        {
            await AddNoticeAsync(new ModerationNotice(reporterId, ModerationNoticeKind.ReportResult, report.Id, null, null, adminUserId, nowUtc), NotificationType.ReportResultNotice, cancellationToken);
            Audit(adminUserId, AdminAuditActions.ReportResultSent, reportId, "reporter", nowUtc);
            await SaveAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> RestrictAsync(long reportId, string? note, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        if (!CanRestrict(report))
        {
            throw new AdminReportConflictException(AdminReportConflictException.NotRestrictable);
        }

        if (await ActiveRestrictionQuery(report).AnyAsync(cancellationToken))
        {
            return true;
        }

        dbContext.ShareRestrictions.Add(new ShareRestriction(report.CollectionId!.Value, report.TargetType == ReportTargetType.Item ? report.TargetId : null, report.Id, adminUserId, nowUtc));
        // The report itself is at least being looked at now; 처리 완료 stays a separate decision.
        report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, note, nowUtc);
        Audit(adminUserId, AdminAuditActions.ShareRestricted, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
        try
        {
            await SaveAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent restriction of the same thing won: the state asked for is in place (and it noticed the person).
            dbContext.ChangeTracker.Clear();
            await transaction.RollbackAsync(cancellationToken);
            return true;
        }

        // The person hears of it in the same transaction as the restriction: no notice without the action, no action without its notice.
        await NotifyActionAsync(report, ModerationActionType.ShareRestricted, userMessage, adminUserId, nowUtc, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> LiftRestrictionAsync(long reportId, string? note, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        var active = await ActiveRestrictionQuery(report).FirstOrDefaultAsync(cancellationToken);
        if (active is null)
        {
            return true;
        }

        active.Lift(adminUserId, nowUtc);
        report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, note, nowUtc);
        Audit(adminUserId, AdminAuditActions.ShareRestrictionLifted, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
        await SaveAsync(cancellationToken);
        await NotifyActionAsync(report, ModerationActionType.ShareRestrictionLifted, userMessage, adminUserId, nowUtc, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> WarnAsync(long reportId, AdminWarningText text, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        if (report.TargetUserId is not { } recipientId
            || !await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == recipientId, cancellationToken)
            || await dbContext.AdminUsers.AsNoTracking().AnyAsync(admin => admin.UserId == recipientId && admin.IsActive, cancellationToken))
        {
            throw new AdminReportConflictException(AdminReportConflictException.NoTargetUser);
        }

        if (await dbContext.ModerationNotices.AnyAsync(
                notice => notice.ReportId == report.Id && notice.RecipientUserId == recipientId && notice.Kind == ModerationNoticeKind.Warning, cancellationToken))
        {
            throw new AdminReportConflictException(AdminReportConflictException.WarningAlreadySent);
        }

        try
        {
            var content = await ContentSnapshotAsync(report, cancellationToken);
            var warning = new ModerationNotice(
                recipientId, ModerationNoticeKind.Warning, report.Id, text.Reason, text.Guidance, adminUserId, nowUtc, null, content.Title, content.Type,
                report.Reason.ToString(), null, content.Id, content.ImageUrl, content.CollectionName);
            await AddNoticeAsync(warning, NotificationType.AdminWarning, cancellationToken);
            // A warning is an operator's decision about this report: at least in review now (처리 완료 stays a separate decision).
            report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, null, nowUtc);
            Audit(adminUserId, AdminAuditActions.ReportWarningSent, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
            await SaveAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // A concurrent warning of the same report won: it was sent, once.
            dbContext.ChangeTracker.Clear();
            throw new AdminReportConflictException(AdminReportConflictException.WarningAlreadySent);
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> DeleteTargetAsync(long reportId, string? note, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        if (!CanDelete(report))
        {
            throw new AdminReportConflictException(AdminReportConflictException.NotDeletable);
        }

        var changed = false;
        if (report.TargetType == ReportTargetType.Item)
        {
            // Only the reported Collection's link to the Item is removed: the Item itself (the person's own saved link) and its places in every other
            // Collection are untouched. The person hears of it first (the snapshot is taken while everything is still in place), then the link goes - one transaction.
            var link = await dbContext.CollectionItems.FirstOrDefaultAsync(
                candidate => candidate.CollectionId == report.CollectionId && candidate.ItemId == report.TargetId, cancellationToken);
            if (link is not null)
            {
                report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, note, nowUtc);
                Audit(adminUserId, AdminAuditActions.ContentDeleted, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
                await NotifyActionAsync(
                    report, ModerationActionType.ContentRemovedFromCollection, userMessage, adminUserId, nowUtc, cancellationToken, link.AddedByUserId, allowOperatorRecipient: true);
                dbContext.CollectionItems.Remove(link);
                await SaveAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return true;
            }
        }
        else
        {
            var collection = await dbContext.Collections.FirstOrDefaultAsync(candidate => candidate.Id == report.TargetId, cancellationToken);
            if (collection is { DeletedAtUtc: null })
            {
                collection.SoftDelete(nowUtc);
                changed = true;
                await Juple.Infrastructure.Collections.JoinRequestHousekeeping.ObsoleteAllPendingAsync(dbContext, collection.Id, nowUtc, cancellationToken);
            }
        }

        report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, note, nowUtc);
        Audit(adminUserId, AdminAuditActions.ContentDeleted, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
        await SaveAsync(cancellationToken);
        if (changed)
        {
            // Only a delete that really changed something is noticed: repeating it (a second click, a reopened report) tells the person nothing new.
            await NotifyActionAsync(report, ModerationActionType.ContentDeleted, userMessage, adminUserId, nowUtc, cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> RestoreTargetAsync(long reportId, string? note, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        if (!CanDelete(report))
        {
            throw new AdminReportConflictException(AdminReportConflictException.NotDeletable);
        }

        var restored = false;
        long? restoredRecipientId = null;
        if (report.TargetType == ReportTargetType.Item)
        {
            var item = await dbContext.Items.FirstOrDefaultAsync(candidate => candidate.Id == report.TargetId && candidate.DeletedAtUtc != null, cancellationToken);
            if (item is not null)
            {
                // A link an earlier version of this action moved into its owner's trash comes back from there.
                item.Restore();
                restored = true;
            }
            else if (report.CollectionId is { } collectionId)
            {
                // Otherwise the removal only took the Collection's link away: put that one link back, for the person who had added it, if everything
                // it needs is still there (the Collection, the link, the person's ownership of it) and nothing already holds its place.
                var adderId = await dbContext.ModerationNotices.AsNoTracking()
                    .Where(notice => notice.ReportId == report.Id && notice.Kind == ModerationNoticeKind.Action && notice.ActionType == ModerationActionType.ContentRemovedFromCollection)
                    .OrderByDescending(notice => notice.Id).Select(notice => (long?)notice.RecipientUserId).FirstOrDefaultAsync(cancellationToken);
                var alreadyThere = await dbContext.CollectionItems.AnyAsync(link => link.CollectionId == collectionId && link.ItemId == report.TargetId, cancellationToken);
                var collectionAlive = await dbContext.Collections.AsNoTracking().AnyAsync(candidate => candidate.Id == collectionId && candidate.DeletedAtUtc == null, cancellationToken);
                var itemOwned = adderId is { } ownerId
                    && await dbContext.Items.AsNoTracking().AnyAsync(candidate => candidate.Id == report.TargetId && candidate.UserId == ownerId && candidate.DeletedAtUtc == null, cancellationToken);
                if (adderId is { } restoringFor && !alreadyThere && collectionAlive && itemOwned)
                {
                    var minSortOrder = await dbContext.CollectionItems.Where(link => link.CollectionId == collectionId)
                        .Select(link => (int?)link.SortOrder).MinAsync(cancellationToken);
                    dbContext.CollectionItems.Add(CollectionItem.CreateNew(
                        collectionId, report.TargetId, restoringFor, nowUtc, minSortOrder is { } existingMin ? existingMin - RestoredLinkSortOrderGap : 0));
                    restored = true;
                    restoredRecipientId = restoringFor;
                }
            }
        }
        else
        {
            var collection = await dbContext.Collections.FirstOrDefaultAsync(candidate => candidate.Id == report.TargetId && candidate.DeletedAtUtc != null, cancellationToken);
            if (collection is not null)
            {
                collection.Restore();
                restored = true;
            }
        }

        if (!restored)
        {
            throw new AdminReportConflictException(AdminReportConflictException.TargetNotDeleted);
        }

        Audit(adminUserId, AdminAuditActions.ContentRestored, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
        await SaveAsync(cancellationToken);
        await NotifyActionAsync(
            report, ModerationActionType.ContentRestored, userMessage, adminUserId, nowUtc, cancellationToken, restoredRecipientId, allowOperatorRecipient: restoredRecipientId is not null);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    public async Task<bool> SetAccountRestrictionAsync(long reportId, bool restricted, string? note, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
        await using var transaction = await dbContext.Database.BeginOrJoinTransactionAsync(cancellationToken);
        var report = await dbContext.ContentReports.FirstOrDefaultAsync(candidate => candidate.Id == reportId, cancellationToken);
        if (report is null)
        {
            return false;
        }

        // Never an operator's own account (that would lock the operators out), never a person that no longer exists.
        var user = report.TargetUserId is { } targetId
            ? await dbContext.Users.FirstOrDefaultAsync(candidate => candidate.Id == targetId, cancellationToken)
            : null;
        if (user is null
            || await dbContext.AdminUsers.AsNoTracking().AnyAsync(admin => admin.UserId == user.Id && admin.IsActive, cancellationToken))
        {
            throw new AdminReportConflictException(AdminReportConflictException.NotAccountRestrictable);
        }

        if (restricted == (user.UsageRestrictedAtUtc is not null))
        {
            await transaction.CommitAsync(cancellationToken);
            return true;
        }

        if (restricted)
        {
            user.RestrictUsage(nowUtc);
        }
        else
        {
            user.LiftUsageRestriction();
        }

        report.Review(report.Status == ReportStatus.Pending ? ReportStatus.InReview : report.Status, adminUserId, note, nowUtc);
        Audit(adminUserId, restricted ? AdminAuditActions.AccountRestricted : AdminAuditActions.AccountRestrictionLifted, reportId, $"{report.TargetType} {report.TargetId}", nowUtc);
        await SaveAsync(cancellationToken);
        await NotifyActionAsync(
            report, restricted ? ModerationActionType.AccountRestricted : ModerationActionType.AccountRestrictionLifted, userMessage, adminUserId, nowUtc, cancellationToken);
        await transaction.CommitAsync(cancellationToken);
        return true;
    }

    /// <summary>
    /// The notice for an operator ACTION that really changed something of the person behind the content (the Item's owner, the Collection's owner, the
    /// account itself), with its Inbox row for the push dispatcher. A snapshot of what it was about (title, type, reason code) and the operator's
    /// reviewed message; nothing of the report's author or text. Guarded by a per-report, per-action sequence key, so two operators acting at the same
    /// moment, or a retry, can never notice the same action twice (the second gets the unique violation and the whole action rolls back).
    /// </summary>
    private async Task NotifyActionAsync(
        ContentReport report, ModerationActionType action, string? userMessage, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken,
        long? recipientOverrideId = null, bool allowOperatorRecipient = false)
    {
        // The person the action is about: for a link taken out of a Collection, whoever put it there (the reported link's adder), else the report's target person.
        var resolvedRecipientId = recipientOverrideId is > 0 ? recipientOverrideId : report.TargetUserId;
        if (resolvedRecipientId is not { } recipientId
            || !await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == recipientId, cancellationToken)
            || (!allowOperatorRecipient && await dbContext.AdminUsers.AsNoTracking().AnyAsync(admin => admin.UserId == recipientId && admin.IsActive, cancellationToken)))
        {
            return;
        }

        var content = await ContentSnapshotAsync(report, cancellationToken);
        var sequence = await dbContext.ModerationNotices.CountAsync(
            notice => notice.ReportId == report.Id && notice.Kind == ModerationNoticeKind.Action && notice.ActionType == action, cancellationToken) + 1;
        var notice = new ModerationNotice(
            recipientId, ModerationNoticeKind.Action, report.Id, null, userMessage, adminUserId, nowUtc, action, content.Title, content.Type,
            report.Reason.ToString(), $"{report.Id}:{(byte)action}:{sequence}", content.Id, content.ImageUrl, content.CollectionName);
        dbContext.ModerationNotices.Add(notice);
        try
        {
            await SaveAsync(cancellationToken);
        }
        catch (DbUpdateException exception) when (SqlServerUniqueConstraintViolationDetector.IsUniqueConstraintViolation(exception))
        {
            // Another operator applied the same action at the same moment: it is applied (and noticed) once - this whole request rolls back.
            dbContext.ChangeTracker.Clear();
            throw new AdminReportConflictException(AdminReportConflictException.ActionAlreadyApplied);
        }

        dbContext.Notifications.Add(Notification.Social(recipientId, NotificationType.AdminWarning, null, null, notice.Id, $"moderation:{notice.Id}", nowUtc));
        await SaveAsync(cancellationToken);
    }

    /// <summary>
    /// What a notice keeps of the content, taken now so it stays readable after a deletion. The title is what the person knows it as: the current one
    /// (also while it is in the trash), else the one the report kept, else the address's host. A link also keeps its preview picture and its Collection's name.
    /// </summary>
    private async Task<ContentSnapshot> ContentSnapshotAsync(ContentReport report, CancellationToken cancellationToken)
    {
        if (report.TargetType == ReportTargetType.Item)
        {
            var item = await dbContext.Items.AsNoTracking().Where(candidate => candidate.Id == report.TargetId)
                .Select(candidate => new { candidate.Title, candidate.Url, candidate.PreviewImageUrl }).FirstOrDefaultAsync(cancellationToken);
            var collectionName = await dbContext.Collections.AsNoTracking().Where(candidate => candidate.Id == report.CollectionId)
                .Select(candidate => candidate.Name).FirstOrDefaultAsync(cancellationToken);
            var title = !string.IsNullOrWhiteSpace(item?.Title) ? item!.Title : report.SnapshotTitle;
            return new ContentSnapshot(
                !string.IsNullOrWhiteSpace(title) ? title : HostOf(item?.Url ?? report.SnapshotUrl), "Item", report.TargetId,
                WebImageUrl(item?.PreviewImageUrl), collectionName);
        }

        if (report.TargetType == ReportTargetType.Collection)
        {
            var name = await dbContext.Collections.AsNoTracking().Where(candidate => candidate.Id == report.TargetId)
                .Select(candidate => candidate.Name).FirstOrDefaultAsync(cancellationToken);
            return new ContentSnapshot(!string.IsNullOrWhiteSpace(name) ? name : report.SnapshotTitle, "Collection", report.TargetId, null, null);
        }

        return new ContentSnapshot(null, null, null, null, null);
    }

    private const int RestoredLinkSortOrderGap = 4096;

    private sealed record ContentSnapshot(string? Title, string? Type, long? Id, string? ImageUrl, string? CollectionName);

    private static string? WebImageUrl(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) && (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp) ? url : null;

    private static string? HostOf(string? url) =>
        Uri.TryCreate(url, UriKind.Absolute, out var uri) ? uri.Host : null;

    /// <summary>The notice and its one Inbox Notification row (the push dispatcher sends it; DB first, a failed push never loses it).</summary>
    private async Task AddNoticeAsync(ModerationNotice notice, NotificationType type, CancellationToken cancellationToken)
    {
        dbContext.ModerationNotices.Add(notice);
        await SaveAsync(cancellationToken);
        dbContext.Notifications.Add(Notification.Social(notice.RecipientUserId, type, null, null, notice.Id, $"moderation:{notice.Id}", notice.CreatedAtUtc));
    }

    /// <summary>Only a link or a Collection is deleted; a person's account and a comment are never deleted by a report.</summary>
    private static bool CanDelete(ContentReport report) =>
        report.TargetType == ReportTargetType.Collection || (report.TargetType == ReportTargetType.Item && report.CollectionId is not null);

    /// <summary>Only a Collection or a link in one can be restricted; a person or a comment is not a thing that is shared.</summary>
    private static bool CanRestrict(ContentReport report) =>
        report.CollectionId is not null && report.TargetType is ReportTargetType.Collection or ReportTargetType.Item;

    private IQueryable<ShareRestriction> ActiveRestrictionQuery(ContentReport report)
    {
        var collectionId = report.CollectionId;
        long? itemId = report.TargetType == ReportTargetType.Item ? report.TargetId : null;
        return CanRestrict(report)
            ? dbContext.ShareRestrictions.Where(restriction => restriction.CollectionId == collectionId && restriction.ItemId == itemId && restriction.LiftedAtUtc == null)
            : dbContext.ShareRestrictions.Where(_ => false);
    }

    private async Task<(bool Exists, string? Title, string? Url)> CurrentTargetAsync(ContentReport report, CancellationToken cancellationToken)
    {
        switch (report.TargetType)
        {
            case ReportTargetType.Collection:
                var collectionName = await dbContext.Collections.AsNoTracking().Where(collection => collection.Id == report.TargetId && collection.DeletedAtUtc == null)
                    .Select(collection => collection.Name).FirstOrDefaultAsync(cancellationToken);
                return (collectionName is not null, collectionName, null);
            case ReportTargetType.Item:
                // A reported link "exists" as long as it is still in the Collection it was reported in (and not in its owner's trash).
                var reportedCollectionId = report.CollectionId;
                var item = await dbContext.Items.AsNoTracking().Where(candidate => candidate.Id == report.TargetId && candidate.DeletedAtUtc == null)
                    .Select(candidate => new
                    {
                        candidate.Title,
                        candidate.Url,
                        InCollection = reportedCollectionId == null
                            || dbContext.CollectionItems.Any(link => link.CollectionId == reportedCollectionId && link.ItemId == candidate.Id),
                    }).FirstOrDefaultAsync(cancellationToken);
                return (item is { InCollection: true }, item?.Title, item?.Url);
            case ReportTargetType.Comment:
                var body = await dbContext.CollectionItemComments.AsNoTracking().Where(comment => comment.Id == report.TargetId && comment.DeletedAtUtc == null)
                    .Select(comment => comment.Body).FirstOrDefaultAsync(cancellationToken);
                return (body is not null, body, null);
            default:
                var exists = report.TargetUserId is { } userId && await dbContext.Users.AsNoTracking().AnyAsync(user => user.Id == userId, cancellationToken);
                return (exists, null, null);
        }
    }

    private async Task<AdminInquiryPerson?> PersonAsync(long? userId, CancellationToken cancellationToken) =>
        userId is null
            ? null
            : await dbContext.Users.AsNoTracking().Where(user => user.Id == userId)
                .Select(user => new AdminInquiryPerson(user.Id, user.PublicCode, user.DisplayName)).FirstOrDefaultAsync(cancellationToken);

    // SaveChanges is one transaction: the change and its audit record cannot exist alone. The detail never carries the content or the note.
    private void Audit(long adminUserId, string action, long reportId, string detail, DateTimeOffset nowUtc) =>
        dbContext.AdminAuditLogs.Add(new AdminAuditLog(adminUserId, action, AdminAuditTargets.ContentReport, reportId.ToString(CultureInfo.InvariantCulture), detail, nowUtc));

    private async Task SaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await dbContext.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Another operator changed the same thing between this request's read and its write (the row version moved): it is applied once; this request rolls back.
            dbContext.ChangeTracker.Clear();
            throw new AdminReportConflictException(AdminReportConflictException.ActionAlreadyApplied);
        }
    }
}
