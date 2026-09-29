namespace Juple.Domain.Collections;

/// <summary>
/// How a shared Collection's recipients (members and public-link visitors - never its Owner) are
/// asked for a password. Persisted by name, so reordering never changes a stored value.
/// </summary>
public enum CollectionSharePasswordMode
{
    /// <summary>No share password: recipients only need their access (membership or a live link).</summary>
    None,

    /// <summary>
    /// Compatibility for Collections that were locked, and already had recipients (a member, an
    /// active public link or a pending invitation), when share passwords were introduced: back then
    /// a locked Collection asked every recipient for the Owner's Collection lock password. While such
    /// a Collection stays locked, those recipients keep being asked for that password - until the
    /// Owner sets a share password of its own (PerCollection) or removes the protection (None), and
    /// there is no way back. Only set by that migration, never assigned to anything new; while in it,
    /// no new recipient (invitation or public link) can be added (sharePasswordMigrationRequired).
    /// </summary>
    LegacyCommonLock,

    /// <summary>This Collection's own share password (independent of the Owner's lock password).</summary>
    PerCollection,
}
