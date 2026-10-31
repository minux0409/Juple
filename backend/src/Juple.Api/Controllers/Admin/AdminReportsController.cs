using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
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
            catch (AdminReportConflictException exception)
            {
                return Conflict(new { code = exception.Code });
            }
        });

    public sealed record ChangeReportStatusRequest(string? Status, string? Note);

    public sealed record ReportNoteRequest(string? Note);
}
