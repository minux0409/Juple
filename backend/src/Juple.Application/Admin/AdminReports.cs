using Juple.Domain.Safety;

namespace Juple.Application.Admin;

public sealed record AdminReportListItem(
    long ReportId,
    DateTimeOffset CreatedAtUtc,
    string TargetType,
    long TargetId,
    long? CollectionId,
    string? SnapshotTitle,
    string Reason,
    string Status,
    string Source,
    AdminInquiryPerson? Reporter,
    bool AdminActionTaken);

public sealed record AdminReportPage(IReadOnlyList<AdminReportListItem> Items, long? NextCursor);

public sealed record AdminReportPriorEntry(long ReportId, DateTimeOffset CreatedAtUtc, string Reason, string Status, string Source);

public sealed record AdminReportDetail(
    long ReportId,
    DateTimeOffset CreatedAtUtc,
    string TargetType,
    long TargetId,
    long? CollectionId,
    string Reason,
    string? Details,
    string Status,
    string Source,
    AdminInquiryPerson? Reporter,
    AdminInquiryPerson? TargetUser,
    string? SnapshotTitle,
    string? SnapshotUrl,
    /// <summary>What it is called now; null when it no longer exists.</summary>
    string? CurrentTitle,
    string? CurrentUrl,
    bool TargetExists,
    bool CanRestrict,
    bool IsRestricted,
    DateTimeOffset? RestrictedAtUtc,
    DateTimeOffset? ReviewedAtUtc,
    AdminInquiryPerson? ReviewedBy,
    string? Note,
    IReadOnlyList<AdminReportPriorEntry> PriorReports,
    IReadOnlyList<AdminAuditEntry> History);

public sealed class AdminReportNotFoundException : Exception;

/// <summary>409: the action does not fit the report's present state; Code tells the Admin Web which.</summary>
public sealed class AdminReportConflictException(string code) : Exception(code)
{
    public const string NotRestrictable = "reportNotRestrictable";
    public const string RestrictionActive = "reportRestrictionActive";

    public string Code { get; } = code;
}

public interface IAdminReportStore
{
    /// <summary>Newest first within the given statuses; keyset cursor.</summary>
    Task<AdminReportPage> ListAsync(IReadOnlyCollection<ReportStatus> statuses, long? cursor, int limit, CancellationToken cancellationToken = default);

    Task<AdminReportDetail?> GetAsync(long reportId, CancellationToken cancellationToken = default);

    /// <summary>The status change and its audit record are one transaction. False = no such report.</summary>
    Task<bool> ChangeStatusAsync(long reportId, ReportStatus status, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>The restriction of the report's Collection or link and its audit record are one transaction; repeating it changes nothing.</summary>
    Task<bool> RestrictAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Lifts the restriction of the report's target, with its audit record; repeating it changes nothing.</summary>
    Task<bool> LiftRestrictionAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);
}

/// <summary>
/// 신고 관리. 검토 중 = InReview, 조치 없음 = Dismissed, 처리 완료 = Actioned; 공유 제한 is a separate decision that can be lifted. Reports are never
/// shown to anyone but operators and nothing here deletes content.
/// </summary>
public sealed class AdminReportService(IAdminReportStore store, TimeProvider timeProvider)
{
    private const int DefaultLimit = 30;
    private const int MaxLimit = 100;

    public Task<AdminReportPage> ListAsync(string? status, long? cursor, int? limit, CancellationToken cancellationToken = default) =>
        store.ListAsync(ParseFilter(status), cursor, Math.Clamp(limit ?? DefaultLimit, 1, MaxLimit), cancellationToken);

    public async Task<AdminReportDetail> GetAsync(long reportId, CancellationToken cancellationToken = default) =>
        await store.GetAsync(reportId, cancellationToken) ?? throw new AdminReportNotFoundException();

    public async Task<AdminReportDetail> ChangeStatusAsync(long adminUserId, long reportId, string? status, string? note, CancellationToken cancellationToken = default)
    {
        var target = status switch
        {
            nameof(ReportStatus.InReview) => ReportStatus.InReview,
            nameof(ReportStatus.Dismissed) => ReportStatus.Dismissed,
            nameof(ReportStatus.Actioned) => ReportStatus.Actioned,
            _ => throw new InvalidAdminRequestException("status", "status must be InReview, Dismissed or Actioned."),
        };
        if (!await store.ChangeStatusAsync(reportId, target, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    public async Task<AdminReportDetail> RestrictAsync(long adminUserId, long reportId, string? note, CancellationToken cancellationToken = default)
    {
        if (!await store.RestrictAsync(reportId, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    public async Task<AdminReportDetail> LiftRestrictionAsync(long adminUserId, long reportId, string? note, CancellationToken cancellationToken = default)
    {
        if (!await store.LiftRestrictionAsync(reportId, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    private static IReadOnlyCollection<ReportStatus> ParseFilter(string? status) => status switch
    {
        null or "" or "Open" => [ReportStatus.Pending, ReportStatus.InReview],
        "Handled" => [ReportStatus.Reviewed, ReportStatus.Dismissed, ReportStatus.Actioned],
        nameof(ReportStatus.Pending) => [ReportStatus.Pending],
        nameof(ReportStatus.InReview) => [ReportStatus.InReview],
        nameof(ReportStatus.Dismissed) => [ReportStatus.Dismissed],
        nameof(ReportStatus.Actioned) => [ReportStatus.Actioned],
        _ => throw new InvalidAdminRequestException("status", "status is not a supported filter."),
    };

    private static string? Note(string? note)
    {
        var trimmed = note?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return null;
        }

        return trimmed.Length <= ContentReport.ResolutionMaxLength
            ? trimmed
            : throw new InvalidAdminRequestException("note", $"note must be at most {ContentReport.ResolutionMaxLength} characters.");
    }
}
