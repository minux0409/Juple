using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// 문의 - operating the EXISTING 고객센터 inquiries (support.SupportInquiries; no second inquiry store). An answer written here is the
/// same row the person reads in 고객센터 > 문의내역. Every change is saved together with an admin.AdminAuditLogs record. The acting
/// admin is always the one the JupleAdmin policy authorized for this request (AdminRequestContext) - never a value from the body.
/// </summary>
[ApiController]
[Route("api/v1/admin/support/inquiries")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
public sealed class AdminSupportInquiriesController(IAdminService adminService) : ControllerBase
{
    /// <summary>Newest first; status = Pending | InProgress | Answered (omitted = all); keyset cursor.</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync([FromQuery] string? status, [FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            var page = await adminService.ListInquiriesAsync(status, cursor, limit, cancellationToken);
            return Ok(new AdminPageResponse<AdminInquiryListItem>(page.Items, AdminResults.Cursor(page.NextCursor)));
        });

    [HttpGet("{inquiryId:long}")]
    public Task<IActionResult> GetAsync(long inquiryId, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () => Ok(await adminService.GetInquiryAsync(inquiryId, cancellationToken)));

    /// <summary>접수 (Pending) <-> 처리중 (InProgress). An answered inquiry cannot be moved back (400).</summary>
    [HttpPut("{inquiryId:long}/status")]
    public Task<IActionResult> ChangeStatusAsync(long inquiryId, [FromBody] ChangeInquiryStatusRequest request, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
            Ok(await adminService.ChangeInquiryStatusAsync(AdminRequestContext.GetRequired(HttpContext).UserId, inquiryId, request.Status, cancellationToken)));

    /// <summary>Records (or replaces) the answer; the inquiry becomes 답변완료 for the person who wrote it.</summary>
    [HttpPut("{inquiryId:long}/answer")]
    public Task<IActionResult> AnswerAsync(long inquiryId, [FromBody] AnswerInquiryRequest request, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
            Ok(await adminService.AnswerInquiryAsync(AdminRequestContext.GetRequired(HttpContext).UserId, inquiryId, request.Answer, cancellationToken)));

    public sealed record ChangeInquiryStatusRequest(string? Status);

    public sealed record AnswerInquiryRequest(string? Answer);
}
