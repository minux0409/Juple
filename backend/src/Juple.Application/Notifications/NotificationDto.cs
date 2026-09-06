using Juple.Domain.Notifications;

namespace Juple.Application.Notifications;

public sealed record NotificationDto(
    long Id,
    NotificationType Type,
    long? RepeatPurchaseId,
    long? ItemId,
    string? ProductNameSnapshot,
    DateOnly? DueDate,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset? ReadAtUtc);
