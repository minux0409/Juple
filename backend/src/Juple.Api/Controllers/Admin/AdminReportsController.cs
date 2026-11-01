using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
using Juple.Domain.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// 신고 관리 (the second tab of the Admin's 문의 관리; reports stay separate from inquiry data). The acting admin is always the one the JupleAdmin
/// policy authorized for this request. Every change is saved together with an audit record, and nothing here deletes content.
/// </summary>
[ApiController]
[Route("api/v1/admin/reports")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
public sealed class AdminReportsController(AdminReportService reports) : ControllerBase
{
    /// <summary>status = Open (default: unhandled first of all) | Handled | Pending | InReview | Dismissed | Actioned; newest first; keyset cursor.</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync([FromQuery] string? status, [FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var page = await reports.ListAsync(status, cursor, limit, cancellationToken);
            return Ok(new AdminPageResponse<AdminReportListItem>(page.Items, AdminResults.Cursor(page.NextCursor)));
        });

    [HttpGet("{reportId:long}")]
    public Task<IActionResult> GetAsync(long reportId, CancellationToken cancellationToken) =>
        Run(async () => Ok(await reports.GetAsync(reportId, cancellationToken)));

    /// <summary>검토 중 (InReview), 조치 없음 (Dismissed; 409 reportRestrictionActive while a restriction is in force), 처리 완료 (Actioned).</summary>
    [HttpPut("{reportId:long}/status")]
    public Task<IActionResult> ChangeStatusAsync(long reportId, [FromBody] ChangeReportStatusRequest request, CancellationToken cancellationToken) =>
        Run(async () => Ok(await reports.ChangeStatusAsync(AdminRequestContext.GetRequired(HttpContext).UserId, reportId, request.Status, request.Note, cancellationToken)));

    /// <summary>공유 제한 of the reported Collection or link (409 reportNotRestrictable for a person or a comment). Idempotent.</summary>
    [HttpPost("{reportId:long}/restriction")]
    public Task<IActionResult> RestrictAsync(long reportId, [FromBody] ReportNoteRequest? request, CancellationToken cancellationToken) =>
        Run(async () => Ok(await reports.RestrictAsync(AdminRequestContext.GetRequired(HttpContext).UserId, reportId, request?.Note, cancellationToken)));

    /// <summary>공유 제한 해제. Idempotent.</summary>
    [HttpPost("{reportId:long}/restriction/lift")]
    public Task<IActionResult> LiftRestrictionAsync(long reportId, [FromBody] ReportNoteRequest? request, CancellationToken cancellationToken) =>
        Run(async () => Ok(await reports.LiftRestrictionAsync(AdminRequestContext.GetRequired(HttpContext).UserId, reportId, request?.Note, cancellationToken)));

    /// <summary>
    /// 경고: the operator's REVIEWED words (신고 내용 + 관리자 안내) go to the person behind the content as an Inbox message and a push. Once per report
    /// (409 warningAlreadySent). Nothing of the report itself - reporter, their explanation - is part of it.
    /// </summary>
    [HttpPost("{reportId:long}/warning")]
    public Task<IActionResult> WarnAsync(long reportId, [FromBody] WarnRequest request, CancellationToken cancellationToken) =>
        Run(async () => Ok(await reports.WarnAsync(AdminRequestContext.GetRequired(HttpContext).UserId, reportId, request.Reason, request.Guidance, cancellationToken)));

    /// <summary>링크 삭제 / 컬렉션 삭제 (soft: into the owner's trash, recoverable). Owner role only, and only with confirm = true. Idempotent.</summary>
    [HttpPost("{reportId:long}/target/delete")]
    public Task<IActionResult> DeleteTargetAsync(long reportId, [FromBody] ConfirmedRequest request, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext);
            return Ok(await reports.DeleteTargetAsync(admin.UserId, admin.Role == AdminRole.Owner, reportId, request.Confirm, request.Note, cancellationToken));
        });

    [HttpPost("{reportId:long}/target/restore")]
    public Task<IActionResult> RestoreTargetAsync(long reportId, [FromBody] ReportNoteRequest? request, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext);
            return Ok(await reports.RestoreTargetAsync(admin.UserId, admin.Role == AdminRole.Owner, reportId, request?.Note, cancellationToken));
        });

    /// <summary>계정 이용 제한 (read-only use) of the person behind the content. Owner role only, confirm = true to set it; never an operator's account.</summary>
    [HttpPost("{reportId:long}/account-restriction")]
    public Task<IActionResult> RestrictAccountAsync(long reportId, [FromBody] ConfirmedRequest request, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext);
            return Ok(await reports.SetAccountRestrictionAsync(admin.UserId, admin.Role == AdminRole.Owner, reportId, restricted: true, request.Confirm, request.Note, cancellationToken));
        });

    [HttpPost("{reportId:long}/account-restriction/lift")]
    public Task<IActionResult> LiftAccountRestrictionAsync(long reportId, [FromBody] ReportNoteRequest? request, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext);
            return Ok(await reports.SetAccountRestrictionAsync(admin.UserId, admin.Role == AdminRole.Owner, reportId, restricted: false, confirm: true, request?.Note, cancellationToken));
        });

    private Task<IActionResult> Run(Func<Task<IActionResult>> action) =>
        AdminResults.RunAsync(this, async () =>
        {
            try
            {
                return await action();
            }
            catch (AdminReportNotFoundException)
            {
                return NotFound();
            }
            catch (AdminReportForbiddenException)
            {
                return StatusCode(StatusCodes.Status403Forbidden, new { code = "ownerRoleRequired" });
            }
            catch (AdminReportConflictException exception)
            {
                return Conflict(new { code = exception.Code });
            }
        });

    public sealed record ChangeReportStatusRequest(string? Status, string? Note);

    public sealed record ReportNoteRequest(string? Note);

    public sealed record WarnRequest(string? Reason, string? Guidance);

    public sealed record ConfirmedRequest(bool Confirm, string? Note);
}
