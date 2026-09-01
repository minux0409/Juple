namespace Juple.Application.Items;

/// <summary>
/// Keyset pagination position for an Item list ordered by StateChangedAtUtc DESC, Id DESC.
/// Carries no authorization information - callers still filter by UserId/State independently.
/// </summary>
public sealed record ItemPageCursor(DateTimeOffset StateChangedAtUtc, long Id);
