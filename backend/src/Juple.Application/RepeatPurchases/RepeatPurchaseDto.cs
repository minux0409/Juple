using Juple.Domain.Purchases;

namespace Juple.Application.RepeatPurchases;

/// <summary>
/// Version carries the raw RowVersion bytes - the API layer, not this one, is responsible for
/// turning it into the opaque wire "version" string (see database-conventions.md: raw byte[]/
/// RowVersion is never named or exposed directly on the wire).
/// </summary>
public sealed record RepeatPurchaseDto(
    long Id,
    long? ItemId,
    string ProductName,
    int IntervalValue,
    IntervalUnit IntervalUnit,
    DateOnly NextPurchaseDate,
    bool IsReminderEnabled,
    int ReminderLeadDays,
    bool IsEnabled,
    DateTimeOffset CreatedAtUtc,
    DateTimeOffset UpdatedAtUtc,
    byte[] Version);
