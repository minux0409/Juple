namespace Juple.Domain.Collections;

/// <summary>
/// What an active public share link lets its holders do. Persisted as its name (string), never its
/// ordinal. Read is the original, anonymous "anyone with the link can view". Write additionally lets
/// holders who are SIGNED IN to Juple add their own links - never anonymously, never anything else
/// (no editing, removing, reordering or managing, and no membership).
/// </summary>
public enum CollectionSharePermission
{
    Read,
    Write,
}
