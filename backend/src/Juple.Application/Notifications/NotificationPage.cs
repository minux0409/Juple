namespace Juple.Application.Notifications;

public sealed record NotificationPage(IReadOnlyList<NotificationDto> Notifications, NotificationPageCursor? NextCursor);
