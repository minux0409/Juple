using Juple.Domain.Billing;
using Juple.Domain.Collections;

namespace Juple.Application.Billing;

/// <summary>
/// What an entitlement means for access - evaluated for the ACTOR / VIEWER, never for a Collection's owner:
/// an expired owner does not freeze an active member's view of the same Collection, and an active owner does not
/// unfreeze an expired member's. (The one exception, later: a public/anonymous write that creates data FOR the owner is
/// gated on the owner's entitlement, because it is the owner who gets new data.)
///
/// Foundation only in R39-A: nothing calls this to change behavior while the program is not launched (CanWrite is then
/// always true and the visibility boundary always null), and the Collection reads do not use the boundary yet.
/// </summary>
public static class EntitlementAccessPolicy
{
    public static bool CanWrite(Entitlement entitlement) => entitlement.CanWrite;

    /// <summary>
    /// The newest shared-Collection content an Expired viewer may still see: what had been added to the Collection by the
    /// moment their access ended. Null means no boundary - everything current is visible (live access, program not launched,
    /// or a viewer who has resubscribed - no catch-up is needed: the very next read simply sees everything again).
    /// </summary>
    public static DateTimeOffset? SharedContentVisibleThroughUtc(Entitlement entitlement) =>
        entitlement.Status == EntitlementStatus.Expired ? entitlement.AccessFrozenAtUtc : null;
}

/// <summary>
/// The ONE place the shared-content freeze condition is written, so the Collection item list, the item open
/// authorization, search, counts, paging and notification eligibility can all use the same boundary rather than six copies.
///
/// The boundary compares <see cref="CollectionItem.VisibleSinceUtc"/> - the instant THIS membership became visible content of
/// THIS Collection: a direct add, the owner's APPROVAL of a proposal (not when it was proposed), or the move/copy time for a
/// target membership. It is deliberately NOT <see cref="CollectionItem.AddedAtUtc"/> (the browsing/history time, which a move
/// or copy carries over) and never the source Item's CreatedAtUtc. A link is visible while VisibleSinceUtc &lt;= the boundary;
/// content exactly at the boundary counts as already visible.
///
/// R39-D must apply this same rule - not a copy of it - to the Collection item count and list, search, detail/open
/// authorization, List/Grid/Image, paging results and collaboration-notification eligibility. It is not wired into any live
/// query in R39-A, and public (anonymous) web reads are never filtered by it.
/// </summary>
public static class SharedContentFreeze
{
    public static IQueryable<CollectionItem> WhereVisibleThrough(this IQueryable<CollectionItem> memberships, DateTimeOffset? visibleThroughUtc) =>
        visibleThroughUtc is { } through
            ? memberships.Where(membership => membership.VisibleSinceUtc <= through)
            : memberships;

    public static bool IsVisibleThrough(DateTimeOffset visibleSinceUtc, DateTimeOffset? visibleThroughUtc) =>
        visibleThroughUtc is null || visibleSinceUtc <= visibleThroughUtc;
}
