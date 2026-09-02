namespace Juple.Domain.Purchases;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values. Mirrors Juple.Domain.Items.ItemState's
/// identical convention.
/// </summary>
public enum IntervalUnit : byte
{
    Day = 0,
    Week = 1,
    Month = 2,
}
