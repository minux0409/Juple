using Juple.Domain.Purchases;

namespace Juple.Application.RepeatPurchases.UpdateRepeatPurchase;

public sealed record UpdateRepeatPurchaseCommand(
    long? ItemId,
    string? ProductName,
    int? IntervalValue,
    IntervalUnit IntervalUnit,
    DateOnly? NextPurchaseDate,
    bool IsReminderEnabled,
    int ReminderLeadDays);
