namespace Juple.Application.Collections.Locking;

/// <summary>
/// What an unlock grant proves - a grant for one purpose is never accepted for the other, so a
/// recipient's share-password grant can never open the Owner's lock, and a lock grant never stands
/// in for a share password.
/// </summary>
public enum CollectionUnlockPurpose
{
    /// <summary>The Collection lock (the Owner's lock password; legacy recipients too).</summary>
    CollectionLock,

    /// <summary>The Collection's own share password (recipients only).</summary>
    SharePassword,
}
