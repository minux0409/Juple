namespace Juple.Domain.Collections;

/// <summary>
/// A Collection's share password - an extra gate for its recipients (members and public-link
/// visitors), never for its Owner, and never a permission of its own: it only applies to someone
/// who already has access. Independent of the Owner's Collection lock password
/// (UserCollectionLockSettings), which keeps guarding the Collection for the Owner.
///
/// The password is kept twice, for two different purposes, and never in plain text:
/// PasswordHash (slow salted hash) is what a recipient's attempt is checked against, and
/// EncryptedPassword (authenticated encryption under a server-held key) lets the Owner see it again
/// on explicit request. PasswordVersion changes whenever the password is set, changed or removed, so
/// every outstanding recipient grant stops working at once.
/// </summary>
public sealed class CollectionSharePassword
{
    private CollectionSharePassword()
    {
    }

    private CollectionSharePassword(long collectionId, CollectionSharePasswordMode mode, DateTimeOffset nowUtc)
    {
        CollectionId = collectionId;
        Mode = mode;
        PasswordVersion = 1;
        CreatedAtUtc = nowUtc;
        UpdatedAtUtc = nowUtc;
    }

    public long Id { get; private set; }

    public long CollectionId { get; private set; }

    public CollectionSharePasswordMode Mode { get; private set; }

    /// <summary>PerCollection only - a slow salted hash, never the password.</summary>
    public string? PasswordHash { get; private set; }

    /// <summary>PerCollection only - an authenticated-encryption envelope, never the password.</summary>
    public string? EncryptedPassword { get; private set; }

    public int PasswordVersion { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }

    public bool IsPerCollection => Mode == CollectionSharePasswordMode.PerCollection;

    public static CollectionSharePassword Create(long collectionId, string passwordHash, string encryptedPassword, DateTimeOffset nowUtc)
    {
        var sharePassword = new CollectionSharePassword(collectionId, CollectionSharePasswordMode.None, nowUtc);
        sharePassword.SetPassword(passwordHash, encryptedPassword, nowUtc);
        sharePassword.PasswordVersion = 1;
        return sharePassword;
    }

    /// <summary>Sets or replaces this Collection's own share password (and leaves any legacy mode behind).</summary>
    public void SetPassword(string passwordHash, string encryptedPassword, DateTimeOffset nowUtc)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(passwordHash);
        ArgumentException.ThrowIfNullOrWhiteSpace(encryptedPassword);
        Mode = CollectionSharePasswordMode.PerCollection;
        PasswordHash = passwordHash;
        EncryptedPassword = encryptedPassword;
        PasswordVersion++;
        UpdatedAtUtc = nowUtc;
    }

    /// <summary>Removes the protection (either kind); access itself - members, links - is untouched.</summary>
    public void Remove(DateTimeOffset nowUtc)
    {
        if (Mode == CollectionSharePasswordMode.None)
        {
            return;
        }

        Mode = CollectionSharePasswordMode.None;
        PasswordHash = null;
        EncryptedPassword = null;
        PasswordVersion++;
        UpdatedAtUtc = nowUtc;
    }
}
