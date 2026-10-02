using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Notifications.Inbox;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in user's Notification Inbox (알림): their own notifications only - anyone else's id
/// is a plain 404, never a 403 that would confirm it exists. Reading never changes anything; read
/// state changes only through the explicit POST actions below, and none of them sends a Push.
/// Rows carry the same wording the Push used (in the requested app language) and ids only for what
/// the caller can open right now - never a comment's text, a memo, a URL, an email or an internal
/// user id. locale is the app language (as the Push registration sends it); unknown → English.
/// </summary>
[ApiController]
[Route("api/v1/notifications")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class NotificationsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    INotificationInboxService inboxService) : ControllerBase
{
    /// <summary>Newest first; cursor is the previous page's nextCursor (keyset by id - no OFFSET).</summary>
    [HttpGet]
    public Task<IActionResult> ListAsync(
        [FromQuery] long? cursor,
        [FromQuery] int? limit,
        [FromQuery] string? locale,
        CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.ListAsync(userId, cursor, limit, locale, cancellationToken),
            page => Ok(new NotificationsResponse(page.Items, page.NextCursor?.ToString(System.Globalization.CultureInfo.InvariantCulture), page.UnreadCount)),
            cancellationToken);

    /// <summary>The bell: unread Inbox rows only - one indexed count, never the list.</summary>
    [HttpGet("unread-count")]
    public Task<IActionResult> UnreadCountAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.CountUnreadAsync(userId, cancellationToken),
            count => Ok(new UnreadCountResponse(count)),
            cancellationToken);

    /// <summary>One notification with its current target - what a Push tap resolves (the Push carries only its id).</summary>
    [HttpGet("{notificationId:long}")]
    public Task<IActionResult> GetAsync(long notificationId, [FromQuery] string? locale, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.GetAsync(userId, notificationId, locale, cancellationToken),
            notification => Ok(notification),
            cancellationToken);

    /// <summary>Idempotent: an already-read notification stays read (its first read time is kept).</summary>
    [HttpPost("{notificationId:long}/read")]
    public Task<IActionResult> MarkReadAsync(long notificationId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.MarkReadAsync(userId, notificationId, cancellationToken),
            result => Ok(result),
            cancellationToken);

    [HttpPost("read-all")]
    public Task<IActionResult> MarkAllReadAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.MarkAllReadAsync(userId, cancellationToken),
            result => Ok(result),
            cancellationToken);

    /// <summary>The Collection was opened: its unread 새 링크 notifications are read. Its 승인 대기 count is untouched.</summary>
    [HttpPost("collections/{collectionId:long}/new-links/read")]
    public Task<IActionResult> MarkCollectionNewLinksReadAsync(long collectionId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.MarkCollectionNewLinksReadAsync(userId, collectionId, cancellationToken),
            result => Ok(result),
            cancellationToken);

    /// <summary>The 승인 대기 list was opened: its approval-request notifications are read - the requests themselves still wait.</summary>
    [HttpPost("collections/{collectionId:long}/submission-requests/read")]
    public Task<IActionResult> MarkCollectionSubmissionRequestsReadAsync(long collectionId, CancellationToken cancellationToken) =>
        ExecuteAsync(
            userId => inboxService.MarkCollectionSubmissionRequestsReadAsync(userId, collectionId, cancellationToken),
            result => Ok(result),
            cancellationToken);

    private async Task<IActionResult> ExecuteAsync<TResult>(
        Func<long, Task<TResult>> action,
        Func<TResult, IActionResult> success,
        CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return success(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (NotificationNotFoundException)
        {
            return NotFound();
        }
        catch (InvalidNotificationRequestException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record NotificationsResponse(IReadOnlyList<NotificationDto> Items, string? NextCursor, int UnreadCount);

    public sealed record UnreadCountResponse(int TotalUnread);
}
