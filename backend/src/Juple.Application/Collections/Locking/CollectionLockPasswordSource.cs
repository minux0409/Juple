namespace Juple.Application.Collections.Locking;

/// <summary>
/// Which stored hash opens a locked Collection. Final rule: the Owner's one lock password
/// (UserCollectionLockSettings) opens every Collection they lock, whenever it exists - a
/// Collection's own legacy hash is then ignored, however recent. Only an Owner who has never set a
/// lock password keeps opening their earlier-locked Collections with those Collections' own legacy
/// passwords, so nobody loses access before choosing one; setting it (which needs a recent real
/// sign-in) switches every one of their Collections over at once. Nothing is inferred or migrated.
/// </summary>
public static class CollectionLockPasswordSource
{
    /// <returns>The hash that verifies, and whether it is the Owner's lock password.</returns>
    public static (string? PasswordHash, bool UsesOwnerPassword) Resolve(string? collectionPasswordHash, string? ownerPasswordHash) =>
        ownerPasswordHash is not null ? (ownerPasswordHash, true) : (collectionPasswordHash, false);
}
