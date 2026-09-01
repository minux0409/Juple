namespace Juple.Domain.Items;

/// <summary>
/// Numeric values are fixed and persisted; do not reorder or reuse a value for a different
/// meaning. Add new members with new numeric values.
/// </summary>
public enum ItemState : byte
{
    Inbox = 0,
    Wishlist = 1,
    Archived = 2,
}
