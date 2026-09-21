namespace Juple.Domain.Collections;

/// <summary>
/// The fixed set of preset pastel colors a user may explicitly assign to a Collection's icon tile -
/// purely presentational, never an arbitrary/HEX value (see docs on Juple's existing pastel
/// palette). Persisted as its string name (see CollectionConfiguration), so reordering these
/// members can never change the meaning of an existing row - mirrors CollectionIcon exactly.
///
/// Unlike CollectionIcon (every Collection always has one, defaulting to Folder),
/// Collection.Color is nullable: null means "no explicit color chosen" - a row that predates this
/// feature, or was seeded without one - and the client falls back to its existing
/// id-deterministic palette for that row (see CategoryIconTile). Only an explicit, non-null value
/// here ever overrides that fallback.
/// </summary>
public enum CollectionColor
{
    Blue,
    Mint,
    Rose,
    Amber,
    Purple,
    Peach,
    Teal,
    Slate,
}
