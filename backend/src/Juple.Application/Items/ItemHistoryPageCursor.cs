namespace Juple.Application.Items;

/// <summary>
/// Keyset pagination position for the History list, ordered by SavedAtUtc DESC, Id DESC (the
/// Item's original save timestamp - never StateChangedAtUtc, unlike ItemPageCursor). Carries no
/// authorization information - callers still filter by UserId independently.
/// </summary>
public sealed record ItemHistoryPageCursor(DateTimeOffset SavedAtUtc, long Id);
