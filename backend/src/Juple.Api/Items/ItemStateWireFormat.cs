using Juple.Domain.Items;

namespace Juple.Api.Items;

/// <summary>
/// Converts the Domain <see cref="ItemState"/> enum to its lowercase wire value. The numeric DB
/// value is never exposed directly on the API; unlike <see cref="ItemsQueryParameters"/>'s query
/// parser (which never accepts "inbox" - GET /api/v1/items only lists Wishlist/Archived), this
/// covers all three states since a single-item lookup can return any of them.
/// </summary>
public static class ItemStateWireFormat
{
    public static string ToWireValue(ItemState state) => state switch
    {
        ItemState.Inbox => "inbox",
        ItemState.Wishlist => "wishlist",
        ItemState.Archived => "archived",
        _ => throw new ArgumentOutOfRangeException(nameof(state), state, "Unknown ItemState."),
    };
}
