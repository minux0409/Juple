using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Admin;
using Juple.Application.Translation;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers.Admin;

/// <summary>
/// 문의 - operating the EXISTING 고객센터 inquiries (support.SupportInquiries; no second inquiry store). An answer written here is the
/// same row the person reads in 고객센터 > 문의내역. Every change is saved together with an admin.AdminAuditLogs record. The acting
/// admin is always the one the JupleAdmin policy authorized for this request (AdminRequestContext) - never a value from the body.
/// The translation workflow (Korean translation of the person's text, an unsent draft, the answer's translation) never changes
/// what the person wrote, and nothing reaches the person before the final send.
/// </summary>
[ApiController]
[Route("api/v1/admin/support/inquiries")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
public sealed class AdminSupportInquiriesController(IAdminService adminService, AdminInquiryWorkflowService workflow) : ControllerBase
{
    /// <summary>Newest first; status = Open (접수 + 처리중) | Pending | InProgress | Answered (omitted = all); keyset cursor.</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync([FromQuery] string? status, [FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken cancellationToken) =>
        AdminResults.RunAsync(this, async () =>
        {
            var page = await adminService.ListInquiriesAsync(status, cursor, limit, cancellationToken);
            return Ok(new AdminPageResponse<AdminInquiryListItem>(page.Items, AdminResults.Cursor(page.NextCursor)));
        });

    [HttpGet("{inquiryId:long}")]
    public Task<IActionResult> GetAsync(long inquiryId, CancellationToken cancellationToken) =>
        Run(async () => Ok(WithState(await adminService.GetInquiryAsync(inquiryId, cancellationToken))));

    /// <summary>접수 (Pending) <-> 처리중 (InProgress). An answered inquiry cannot be moved back (400).</summary>
    [HttpPut("{inquiryId:long}/status")]
    public Task<IActionResult> ChangeStatusAsync(long inquiryId, [FromBody] ChangeInquiryStatusRequest request, CancellationToken cancellationToken) =>
        Run(async () =>
            Ok(WithState(await adminService.ChangeInquiryStatusAsync(AdminRequestContext.GetRequired(HttpContext).UserId, inquiryId, request.Status, cancellationToken))));

    /// <summary>
    /// Records (or replaces) the answer; the inquiry becomes 답변완료 for the person who wrote it. With language (the Admin Web's
    /// translation workflow) answer is exactly what the person reads and sourceKo its Korean original; expectedUpdatedAtUtc
    /// refuses the send (409 inquiryChanged) when the inquiry changed since it was loaded, and resending the same answer is a
    /// no-op. Without language it is the original Korean-only answer.
    /// </summary>
    [HttpPut("{inquiryId:long}/answer")]
    public Task<IActionResult> AnswerAsync(long inquiryId, [FromBody] AnswerInquiryRequest request, CancellationToken cancellationToken) =>
        Run(async () =>
        {
            var admin = AdminRequestContext.GetRequired(HttpContext).UserId;
            var detail = request.Language is null
                ? await adminService.AnswerInquiryAsync(admin, inquiryId, request.Answer, cancellationToken)
                : await workflow.SendAnswerAsync(admin, inquiryId, request.Answer, request.SourceKo, request.Language, request.ExpectedUpdatedAtUtc, cancellationToken);
            return Ok(WithState(detail));
        });

    /// <summary>Machine-translates what the person wrote into Korean and keeps it beside the original (the original is untouched).</summary>
    [HttpPost("{inquiryId:long}/content-translation")]
    public Task<IActionResult> TranslateContentAsync(long inquiryId, CancellationToken cancellationToken) =>
        Run(async () => Ok(WithState(await workflow.TranslateContentAsync(inquiryId, cancellationToken))));

    /// <summary>임시 저장: the Korean answer, its translation and language - never visible to the person.</summary>
    [HttpPut("{inquiryId:long}/answer-draft")]
    public Task<IActionResult> SaveDraftAsync(long inquiryId, [FromBody] AdminInquiryDraftRequest request, CancellationToken cancellationToken) =>
        Run(async () => Ok(WithState(await workflow.SaveDraftAsync(inquiryId, request, cancellationToken))));

    /// <summary>번역하기: the Korean answer in the person's language. Nothing is saved or sent.</summary>
    [HttpPost("{inquiryId:long}/answer-translation")]
    public Task<IActionResult> TranslateAnswerAsync(long inquiryId, [FromBody] AdminInquiryAnswerTranslationRequest request, CancellationToken cancellationToken) =>
        Run(async () => Ok(await workflow.TranslateAnswerAsync(inquiryId, request, cancellationToken)));

    private AdminInquiryDetail WithState(AdminInquiryDetail detail) => detail with { Translation = workflow.TranslationState };

    private Task<IActionResult> Run(Func<Task<IActionResult>> action) =>
        AdminResults.RunAsync(this, async () =>
        {
            try
            {
                return await action();
            }
            catch (AdminInquiryChangedException)
            {
                return Conflict(new { code = "inquiryChanged" });
            }
            catch (TranslationUnavailableException exception)
            {
                return Conflict(new { code = exception.Code switch
                {
                    "notConfigured" => "translationNotConfigured",
                    "inquiryTranslationNotAllowed" => "inquiryTranslationNotAllowed",
                    var other => "translation_" + other,
                } });
            }
        });

    public sealed record ChangeInquiryStatusRequest(string? Status);

    public sealed record AnswerInquiryRequest(string? Answer, string? SourceKo = null, string? Language = null, DateTimeOffset? ExpectedUpdatedAtUtc = null);
}
