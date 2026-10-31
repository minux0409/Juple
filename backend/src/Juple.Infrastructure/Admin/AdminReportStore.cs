using System.Globalization;
using Juple.Application.Admin;
using Juple.Domain.Admin;
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
            history);
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
        await SaveAsync(cancellationToken);
        return true;
    }

    public async Task<bool> RestrictAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
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
            // A concurrent restriction of the same thing won: the state asked for is in place.
            dbContext.ChangeTracker.Clear();
        }

        return true;
    }

    public async Task<bool> LiftRestrictionAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default)
    {
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
        return true;
    }

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
                var item = await dbContext.Items.AsNoTracking().Where(candidate => candidate.Id == report.TargetId && candidate.DeletedAtUtc == null)
                    .Select(candidate => new { candidate.Title, candidate.Url }).FirstOrDefaultAsync(cancellationToken);
                return (item is not null, item?.Title, item?.Url);
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

    private Task SaveAsync(CancellationToken cancellationToken) => dbContext.SaveChangesAsync(cancellationToken);
}
