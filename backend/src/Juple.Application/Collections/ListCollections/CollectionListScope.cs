namespace Juple.Application.Collections.ListCollections;

/// <summary>
/// Which of the caller's accessible Collections a list returns. Owned/Shared are split by the
/// server-side role (never inferred by clients); All is both; Favorites is both, restricted to the
/// caller's own favorite marks.
/// </summary>
public enum CollectionListScope
{
    Owned,
    Shared,
    All,
    Favorites,
}
