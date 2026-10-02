namespace Juple.Application.Collections.ListCollections;

/// <summary>
/// Which of the caller's accessible Collections a list returns (each row's role always comes from
/// the server, never inferred by clients). Owned: the caller's own. Shared: every Collection the
/// caller shares with someone - shared with them, plus their own ones that currently have members
/// or an active 모든 사용자 link (those are also in Owned). All: owned + shared with them, each
/// once. Favorites: All, restricted to the caller's own favorite marks. MyPending: only the
/// Collections the caller is a MEMBER of in which they have at least one proposal of their own still
/// waiting for the Owner (승인 후 추가) - the Collections behind the 내 승인 대기 number; never
/// public-link-only Collections (the caller is no member there) and never the Owner's own.
/// </summary>
public enum CollectionListScope
{
    Owned,
    Shared,
    All,
    Favorites,
    MyPending,
}
