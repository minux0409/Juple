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
    IReadOnlyList<AdminAuditEntry> History)
{
    /// <summary>A report with a person behind the content: an operator may send them a reviewed warning, once per report.</summary>
    public bool CanWarn { get; init; }

    /// <summary>Set once the warning was sent: it cannot be sent twice. The words sent are never repeated back here.</summary>
    public DateTimeOffset? WarningSentAtUtc { get; init; }

    public bool WarningAcknowledged { get; init; }

    /// <summary>A link or a Collection can be deleted (soft - recoverable) by an Owner-role operator; a person or a comment cannot.</summary>
    public bool CanDeleteTarget { get; init; }

    /// <summary>The reported link or Collection is in the trash (soft-deleted by an operator or by its owner); it can be restored.</summary>
    public bool TargetDeleted { get; init; }

    /// <summary>The person behind the content can have their account use restricted (read-only) - never automatic.</summary>
    public bool CanRestrictAccount { get; init; }

    public bool TargetAccountRestricted { get; init; }
}

public sealed class AdminReportNotFoundException : Exception;

/// <summary>409: the action does not fit the report's present state; Code tells the Admin Web which.</summary>
public sealed class AdminReportConflictException(string code) : Exception(code)
{
    public const string NotRestrictable = "reportNotRestrictable";
    public const string RestrictionActive = "reportRestrictionActive";
    public const string NotDeletable = "reportNotDeletable";
    public const string NoTargetUser = "reportHasNoTargetUser";
    public const string WarningAlreadySent = "warningAlreadySent";
    public const string NotAccountRestrictable = "reportNotAccountRestrictable";
    public const string TargetNotDeleted = "reportTargetNotDeleted";

    public string Code { get; } = code;
}

/// <summary>403: this action needs the Owner role (deleting content, restricting an account).</summary>
public sealed class AdminReportForbiddenException : Exception;

/// <summary>The operator's reviewed words of a warning (신고 내용 + 관리자 안내): sent as written, after the operator saw them.</summary>
public sealed record AdminWarningText(string Reason, string? Guidance);

public interface IAdminReportStore
{
    /// <summary>
    /// The warning, its Inbox notification (one Notification row for the push dispatcher: DB first, FCM after, a failed push never loses it) and the
    /// audit record are ONE transaction. Throws AdminReportConflictException (warningAlreadySent / reportHasNoTargetUser). False = no such report.
    /// </summary>
    Task<bool> WarnAsync(long reportId, AdminWarningText text, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Soft-deletes the reported link (into its owner's trash) or Collection, with its audit record. Idempotent. Conflict reportNotDeletable for a person or a comment.</summary>
    Task<bool> DeleteTargetAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Undoes DeleteTargetAsync. Conflict reportTargetNotDeleted when there is nothing to restore.</summary>
    Task<bool> RestoreTargetAsync(long reportId, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

    /// <summary>Sets or lifts the read-only use restriction of the person behind the reported content, with its audit record. Idempotent.</summary>
    Task<bool> SetAccountRestrictionAsync(long reportId, bool restricted, string? note, long adminUserId, DateTimeOffset nowUtc, CancellationToken cancellationToken = default);

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

    public async Task<AdminReportDetail> WarnAsync(long adminUserId, long reportId, string? reason, string? guidance, CancellationToken cancellationToken = default)
    {
        var trimmedReason = reason?.Trim();
        if (string.IsNullOrEmpty(trimmedReason) || trimmedReason.Length > ModerationNotice.ReasonMaxLength)
        {
            throw new InvalidAdminRequestException("reason", $"reason is required and at most {ModerationNotice.ReasonMaxLength} characters.");
        }

        var trimmedGuidance = guidance?.Trim();
        if (trimmedGuidance is { Length: > ModerationNotice.GuidanceMaxLength })
        {
            throw new InvalidAdminRequestException("guidance", $"guidance must be at most {ModerationNotice.GuidanceMaxLength} characters.");
        }

        var text = new AdminWarningText(trimmedReason, string.IsNullOrEmpty(trimmedGuidance) ? null : trimmedGuidance);
        if (!await store.WarnAsync(reportId, text, adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    /// <summary>Deleting content needs the Owner role AND an explicit confirmation in the request.</summary>
    public async Task<AdminReportDetail> DeleteTargetAsync(long adminUserId, bool isOwner, long reportId, bool confirm, string? note, CancellationToken cancellationToken = default)
    {
        RequireOwner(isOwner);
        RequireConfirmed(confirm);
        if (!await store.DeleteTargetAsync(reportId, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    public async Task<AdminReportDetail> RestoreTargetAsync(long adminUserId, bool isOwner, long reportId, string? note, CancellationToken cancellationToken = default)
    {
        RequireOwner(isOwner);
        if (!await store.RestoreTargetAsync(reportId, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    public async Task<AdminReportDetail> SetAccountRestrictionAsync(long adminUserId, bool isOwner, long reportId, bool restricted, bool confirm, string? note, CancellationToken cancellationToken = default)
    {
        RequireOwner(isOwner);
        if (restricted)
        {
            RequireConfirmed(confirm);
        }

        if (!await store.SetAccountRestrictionAsync(reportId, restricted, Note(note), adminUserId, timeProvider.GetUtcNow(), cancellationToken))
        {
            throw new AdminReportNotFoundException();
        }

        return await GetAsync(reportId, cancellationToken);
    }

    private static void RequireOwner(bool isOwner)
    {
        if (!isOwner)
        {
            throw new AdminReportForbiddenException();
        }
    }

    private static void RequireConfirmed(bool confirm)
    {
        if (!confirm)
        {
            throw new InvalidAdminRequestException("confirm", "This action must be confirmed explicitly.");
        }
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
