using Juple.Api.Authentication;
using Juple.Api.Billing;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Notices;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/notices")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[AllowWhenSubscriptionExpired]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public sealed class NoticesController(NoticeService notices, IExternalIdentityAccessor identity, ICurrentJupleUserAccessor current) : ControllerBase {
    private Task<IActionResult> Run(Func<long, Task<IActionResult>> action, CancellationToken ct) => NoticeResults.Run(this, async () => {
        var user = await current.GetRequiredAsync(identity.GetRequired(), ct); return await action(user.UserId);
    });
    [HttpGet] public Task<IActionResult> List([FromQuery] string platform, [FromQuery] string? language, [FromQuery] string? cursor, [FromQuery] int? limit, CancellationToken ct) =>
        Run(async user => Ok(await notices.ListAsync(user, platform, language, cursor, limit, ct)), ct);
    [HttpGet("unread")] public Task<IActionResult> Unread([FromQuery] string platform, CancellationToken ct) =>
        Run(async user => Ok(new { hasUnread = await notices.HasUnreadAsync(user, platform, ct) }), ct);
    [HttpGet("{id:long}")] public Task<IActionResult> Get(long id, [FromQuery] string platform, [FromQuery] string? language, CancellationToken ct) =>
        Run(async user => Ok(await notices.GetAsync(user, id, platform, language, ct)), ct);
    [HttpPut("{id:long}/read")] public Task<IActionResult> Read(long id, [FromQuery] string platform, [FromBody] ReadRequest body, CancellationToken ct) =>
        Run(async user => { await notices.MarkReadAsync(user, id, platform, body.ReadVersion, ct); return NoContent(); }, ct);
    public sealed record ReadRequest(int ReadVersion);
}
internal static class NoticeResults {
    public static async Task<IActionResult> Run(ControllerBase c, Func<Task<IActionResult>> action) {
        try { return await action(); }
        catch (NoticeNotFoundException) { return c.NotFound(); }
        catch (NoticeConflictException) { return c.Conflict(new { code = "noticeChanged" }); }
        catch (InvalidNoticeException e) { c.ModelState.AddModelError(e.Field, e.Message); return c.ValidationProblem(c.ModelState); }
        catch (UnauthorizedAccessException) { return c.Forbid(); }
        catch (CurrentJupleUserNotFoundException) { return c.Problem(statusCode: 409, title: "Juple user bootstrap is required."); }
    }
}
