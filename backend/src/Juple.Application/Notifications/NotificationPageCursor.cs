namespace Juple.Application.Notifications;

/// <summary>Keyset pagination position for the Notification inbox, ordered by CreatedAtUtc DESC, Id DESC.</summary>
public sealed record NotificationPageCursor(DateTimeOffset CreatedAtUtc, long Id);
