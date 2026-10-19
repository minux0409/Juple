namespace Juple.Domain.Admin;

/// <summary>
/// What an operator may do in the Admin Web. Stored by name (see AdminUserConfiguration), so reordering never changes what an
/// existing row means. Owner and Admin have the same operating rights today; Owner is reserved for later sensitive operations
/// (granting/revoking other admins, operating settings) so those can be restricted without a schema change.
/// </summary>
public enum AdminRole
{
    Owner,
    Admin,
}

/// <summary>
/// An explicit operator grant for ONE internal Juple user (never an email, an external Entra id or anything the client sends).
/// The Admin authorization policy accepts a request only when the authenticated principal maps to a user with an ACTIVE grant.
/// Grants are created out of band by an operator (see docs/admin.md) - no API creates one.
/// </summary>
public sealed class AdminUser
{
    private AdminUser()
    {
    }

    public AdminUser(long userId, AdminRole role, long? grantedByUserId, DateTimeOffset createdAtUtc)
    {
        UserId = userId;
        Role = role;
        IsActive = true;
        GrantedByUserId = grantedByUserId;
        CreatedAtUtc = createdAtUtc;
        UpdatedAtUtc = createdAtUtc;
    }

    public long Id { get; private set; }

    /// <summary>The internal Juple UserId (Users.Id) - the only source of admin authority.</summary>
    public long UserId { get; private set; }

    public AdminRole Role { get; private set; }

    /// <summary>False = the grant is kept for the record but authorizes nothing.</summary>
    public bool IsActive { get; private set; }

    /// <summary>The internal UserId of the admin who granted it; null for the first Owner (granted by an operator procedure).</summary>
    public long? GrantedByUserId { get; private set; }

    public DateTimeOffset CreatedAtUtc { get; private set; }

    public DateTimeOffset UpdatedAtUtc { get; private set; }
}
