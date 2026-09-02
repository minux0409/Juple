using Juple.Domain.Purchases;

namespace Juple.Application.RepeatPurchases;

/// <summary>
/// Normalized RepeatPurchase field values, shared by Create and Update against IRepeatPurchaseStore.
/// IsEnabled is deliberately not here - Create always starts a RepeatPurchase enabled and Update
/// never touches it; only the dedicated Enable/Disable use cases do. Callers must have already
/// validated/normalized every field - see RepeatPurchaseFieldsNormalizer.
/// </summary>
public sealed record RepeatPurchaseFields(
    long? ItemId,
    string ProductName,
    int IntervalValue,
    IntervalUnit IntervalUnit,
    DateOnly NextPurchaseDate,
    bool IsReminderEnabled,
    int ReminderLeadDays);
