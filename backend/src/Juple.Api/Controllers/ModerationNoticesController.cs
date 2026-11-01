using Juple.Application.Identity;
using Juple.Api.Billing;
using Juple.Application.Safety;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The operators' messages to the signed-in person (이용 안내, and the result of their own report): read one, confirm it. Only the recipient's own
/// notice exists for the caller. Open to a restricted or unsubscribed account - a warning must always be readable.
/// </summary>
[ApiController]
[Authorize]
[Route("api/v1/moderation-notices")]
[AllowWhenSubscriptionExpired]
public sealed class ModerationNoticesController(
    IModerationNoticeStore store,
    ICurrentJupleUserAccessor currentUserAccessor,
    IExternalIdentityAccessor externalIdentityAccessor,
    TimeProvider timeProvider) : ControllerBase
{
    /// <summary>The operator messages (warning / action) this person has not confirmed yet, oldest first (at most 20) - what the app shows as 운영팀 안내.</summary>
    [HttpGet("unacknowledged")]
    public async Task<IActionResult> ListUnacknowledgedAsync(CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
        return Ok(new { items = await store.ListUnacknowledgedAsync(user.UserId, 20, cancellationToken) });
    }

    [HttpGet("{noticeId:long}")]
    public async Task<IActionResult> GetAsync(long noticeId, CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
        var notice = await store.GetAsync(user.UserId, noticeId, cancellationToken);
        return notice is null ? NotFound() : Ok(notice);
    }

    [HttpPost("{noticeId:long}/acknowledge")]
    public async Task<IActionResult> AcknowledgeAsync(long noticeId, CancellationToken cancellationToken)
    {
        var user = await currentUserAccessor.GetRequiredAsync(externalIdentityAccessor.GetRequired(), cancellationToken);
        return await store.AcknowledgeAsync(user.UserId, noticeId, timeProvider.GetUtcNow(), cancellationToken) ? NoContent() : NotFound();
    }
}
