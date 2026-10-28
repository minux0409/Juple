using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Notices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace Juple.Api.Controllers.Admin;

[ApiController]
[Route("api/v1/admin/notices")]
[Authorize(Policy = AuthorizationPolicies.JupleAdmin)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class AdminNoticesController(NoticeService notices, NoticeTranslationService translations) : ControllerBase {
    /// <summary>Whether machine translation is available (provider name only - never a key or endpoint).</summary>
    [HttpGet("translation-status")] public IActionResult TranslationStatus() => Ok(new { provider = translations.ProviderName, configured = translations.IsConfigured, languages = NoticeService.Languages });
    /// <summary>
    /// Machine-translates the Korean draft into the given languages (default: all others) WITHOUT saving anything. 409
    /// translationNotConfigured when no provider is configured; a failing language is reported as failed with its code.
    /// </summary>
    [HttpPost("translations")] public Task<IActionResult> Translate([FromBody] NoticeTranslateRequest body, CancellationToken ct) => NoticeResults.Run(this, async () => {
        try { return Ok(await translations.TranslateAsync(body, ct)); }
        catch (Juple.Application.Translation.TranslationUnavailableException e) {
            return e.Code == "busy" ? StatusCode(429, new { code = "translationBusy" }) : Conflict(new { code = e.Code == "notConfigured" ? "translationNotConfigured" : "translation_" + e.Code });
        }
    });
    [HttpGet] public Task<IActionResult> List([FromQuery] string? search, [FromQuery] string? status, [FromQuery] long? cursor, [FromQuery] int? limit, CancellationToken ct) =>
        NoticeResults.Run(this, async () => Ok(await notices.AdminListAsync(search, status, cursor, limit, ct)));
    [HttpGet("{id:long}")] public Task<IActionResult> Get(long id, CancellationToken ct) => NoticeResults.Run(this, async () => Ok(await notices.AdminGetAsync(id, ct)));
    [HttpPost] public Task<IActionResult> Create([FromBody] NoticeWrite body, CancellationToken ct) => NoticeResults.Run(this, async () => {
        var n = await notices.SaveAsync(AdminRequestContext.GetRequired(HttpContext).UserId, null, body, ct); return Created($"/api/v1/admin/notices/{n.Id}", n);
    });
    [HttpPut("{id:long}")] public Task<IActionResult> Update(long id, [FromBody] NoticeWrite body, CancellationToken ct) => NoticeResults.Run(this,
        async () => Ok(await notices.SaveAsync(AdminRequestContext.GetRequired(HttpContext).UserId, id, body, ct)));
    [HttpDelete("{id:long}")] public Task<IActionResult> Delete(long id, [FromQuery] string version, CancellationToken ct) => NoticeResults.Run(this, async () => {
        await notices.DeleteAsync(AdminRequestContext.GetRequired(HttpContext).UserId, id, version, ct); return NoContent();
    });
}
