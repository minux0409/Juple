namespace Juple.Domain.Collections;

/// <summary>
/// The fixed set of decorative icons a user may assign to a Collection - purely presentational,
/// never inferred/guessed (see docs/product-overview.md's "모르면 모른다고 한다" principle - a new
/// Collection always starts on the explicit Folder default, never a guess based on its name).
/// Persisted as a string (see CollectionConfiguration), so reordering these members can never
/// change the meaning of an existing row.
/// </summary>
public enum CollectionIcon
{
    Folder,
    Heart,
    Plane,
    Gamepad,
    Utensils,
    ShoppingBag,
    Home,
    Laptop,
    Globe,
    Tag,
}
