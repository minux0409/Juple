namespace Juple.Application.Collections;

/// <summary>
/// The order GET /api/v1/collections/{id}/items pages through. Manual (no `sort` parameter) is the
/// original contract - the owner's SortOrder, newest-added first unless reordered - so a client that
/// never sends `sort` keeps exactly what it always got. DateDesc/DateAsc order the whole Collection
/// by when each link was added (AddedAtUtc, ties broken by ItemId), newest or oldest first.
/// </summary>
public enum CollectionItemSort
{
    Manual,
    DateDesc,
    DateAsc,
}
