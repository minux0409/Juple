using Juple.Api.Authentication;
using Juple.Api.Notifications;
using Juple.Application.Identity;
using Juple.Application.Notifications;
using Juple.Application.Notifications.GetUnreadNotificationCount;
using Juple.Application.Notifications.ListNotifications;
using Juple.Application.Notifications.MarkAllNotificationsRead;
using Juple.Application.Notifications.MarkNotificationRead;
using Juple.Application.Users.CurrentUser;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The user's in-app notification inbox (currently: RepeatPurchase due notifications only - see
/// Notification). Every GET here materializes newly-due notifications first (see
/// IListNotificationsService/IGetUnreadNotificationCountService) - there is no background scheduler
/// yet, so a stale inbox self-heals the moment the client asks for it.
/// </summary>
[ApiController]
[Route("api/v1/notifications")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class NotificationsController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IListNotificationsService listNotificationsService,
    IGetUnreadNotificationCountService getUnreadNotificationCountService,
    IMarkNotificationReadService markNotificationReadService,
    IMarkAllNotificationsReadService markAllNotificationsReadService) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> ListAsync(
        [FromQuery] int? limit,
        [FromQuery] string? cursor,
        CancellationToken cancellationToken)
    {
        if (!NotificationsQueryParameters.TryParseLimit(limit, out var resolvedLimit))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["limit"] = [
                    $"limit must be between {NotificationsQueryParameters.MinLimit} and {NotificationsQueryParameters.MaxLimit}.",
                ],
            }));
        }

        NotificationPageCursor? typedCursor = null;
        if (cursor is not null && !NotificationPageCursorCodec.TryDecode(cursor, out typedCursor))
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["cursor"] = ["cursor is invalid."],
            }));
        }

        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var page = await listNotificationsService.ListAsync(
                currentUser.UserId, currentUser.TimeZoneId, typedCursor, resolvedLimit, cancellationToken);

            return Ok(new NotificationsPageResponse(
                page.Notifications.Select(ToResponse).ToList(),
                page.NextCursor is { } nextCursor ? NotificationPageCursorCodec.Encode(nextCursor) : null));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpGet("unread-count")]
    public async Task<IActionResult> GetUnreadCountAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var count = await getUnreadNotificationCountService.GetAsync(
                currentUser.UserId, currentUser.TimeZoneId, cancellationToken);

            return Ok(new UnreadNotificationCountResponse(count));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    [HttpPost("{id:long}/read")]
    public async Task<IActionResult> MarkReadAsync(long id, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await markNotificationReadService.MarkReadAsync(currentUser.UserId, id, cancellationToken);
            return NoContent();
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
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> MarkAllReadAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await markAllNotificationsReadService.MarkAllReadAsync(currentUser.UserId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }

    private static NotificationResponse ToResponse(NotificationDto notification) => new(
        notification.Id,
        NotificationTypeWireFormat.ToWireValue(notification.Type),
        notification.RepeatPurchaseId,
        notification.ItemId,
        notification.ProductNameSnapshot,
        notification.DueDate,
        notification.CreatedAtUtc,
        notification.ReadAtUtc,
        notification.ReadAtUtc is not null);

    public sealed record NotificationResponse(
        long Id,
        string Type,
        long? RepeatPurchaseId,
        long? ItemId,
        string? ProductName,
        DateOnly? DueDate,
        DateTimeOffset CreatedAtUtc,
        DateTimeOffset? ReadAtUtc,
        bool IsRead);

    public sealed record NotificationsPageResponse(
        IReadOnlyList<NotificationResponse> Notifications, string? NextCursor);

    public sealed record UnreadNotificationCountResponse(int UnreadCount);
}
