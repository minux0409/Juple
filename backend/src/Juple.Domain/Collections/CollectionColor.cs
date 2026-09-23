namespace Juple.Domain.Collections;

/// <summary>
/// The fixed set of preset pastel colors a user may explicitly assign to a Collection's icon tile -
/// purely presentational. These names remain the backward-compatible preset wire values; a
/// user-selected custom hue is persisted separately as a validated #RRGGBB string on Collection.
/// Reordering these members can therefore never change the meaning of an existing preset row.
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
    Coral,
    Lime,
    Sky,
    Indigo,
    Lavender,
    Sand,
}
