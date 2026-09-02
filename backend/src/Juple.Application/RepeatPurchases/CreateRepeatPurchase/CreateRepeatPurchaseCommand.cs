using Juple.Domain.Purchases;

namespace Juple.Application.RepeatPurchases.CreateRepeatPurchase;

public sealed record CreateRepeatPurchaseCommand(
    long? ItemId,
    string? ProductName,
    int? IntervalValue,
    IntervalUnit IntervalUnit,
    DateOnly? NextPurchaseDate,
    bool IsReminderEnabled,
    int ReminderLeadDays);
