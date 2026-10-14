using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.DeleteAccount;

/// <summary>
/// Settings for deleting the Microsoft Entra External ID sign-in account together with the Juple account.
/// Off by default: while <see cref="Enabled"/> is false, account deletion behaves exactly as before (Juple data only) and
/// no Graph call is ever made, so an environment that is not configured yet is unaffected.
/// </summary>
public sealed class EntraAccountDeletionOptions
{
    public const string SectionName = "EntraAccountDeletion";

    public bool Enabled { get; init; }

    /// <summary>The External ID (customer) tenant the sign-in accounts live in. A user of any other tenant is never touched.</summary>
    public Guid TenantId { get; init; }

    /// <summary>The app registration (in that tenant) holding the Graph application permission.</summary>
    public string ClientId { get; init; } = string.Empty;

    /// <summary>
    /// The app registration's client secret (a secret: Container Apps secret / Key Vault reference, never a committed file). The
    /// API's managed identity lives in the Azure subscription's tenant, not in <see cref="TenantId"/>, so it cannot hold Graph roles
    /// itself; the app registration in the customer tenant does, and this is how the API proves to be it.
    /// </summary>
    public string? ClientSecret { get; init; }

    /// <summary>
    /// Alternative to <see cref="ClientSecret"/> (no secret anywhere): the API's user-assigned managed identity vouches for the app
    /// registration through a federated identity credential. Entra refused this cross-tenant combination for the DEV External ID
    /// tenant (AADSTS700236), so the secret is what is deployed; the path stays for a tenant where it is accepted.
    /// </summary>
    public string ManagedIdentityClientId { get; init; } = string.Empty;

    public string? Validate() =>
        !Enabled ? null
        : TenantId == Guid.Empty ? "EntraAccountDeletion:TenantId is required when enabled."
        : string.IsNullOrWhiteSpace(ClientId) ? "EntraAccountDeletion:ClientId is required when enabled."
        : string.IsNullOrWhiteSpace(ClientSecret) && string.IsNullOrWhiteSpace(ManagedIdentityClientId)
            ? "EntraAccountDeletion needs ClientSecret or ManagedIdentityClientId when enabled."
        : null;
}

public enum EntraIdentityDeletionOutcome
{
    Deleted,
    AlreadyGone,
}

/// <summary>A directory call failed (transport, permission, throttling). Carries a sanitized code only.</summary>
public sealed class EntraDirectoryException(string code) : Exception("The Entra directory call failed: " + code)
{
    public string Code { get; } = code;
}

/// <summary>
/// The only two things Juple asks of the sign-in directory, both about ONE identity that the server itself resolved from the
/// signed-in user's own stored external identity - never an id taken from a request.
/// </summary>
public interface IEntraIdentityDirectory
{
    /// <summary>
    /// The account's sign-in email address, or null when the directory has none or does not answer. Used only to remember the
    /// free-trial window under a keyed hash of the email (the Entra object id changes when the same person signs up again).
    /// </summary>
    Task<string?> GetSignInEmailAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default);

    /// <summary>Deletes the user; "not found" is success (AlreadyGone). Anything else that fails throws <see cref="EntraDirectoryException"/>.</summary>
    Task<EntraIdentityDeletionOutcome> DeleteUserAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default);
}

/// <summary>Persistence of <see cref="PendingEntraIdentityDeletion"/>.</summary>
public interface IEntraIdentityDeletionStore
{
    Task<PendingEntraIdentityDeletion?> FindAsync(long id, CancellationToken cancellationToken = default);

    Task<PendingEntraIdentityDeletion?> FindForIdentityAsync(ExternalIdentityPrincipal identity, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<long>> ListPendingIdsAsync(int limit, CancellationToken cancellationToken = default);

    Task CompleteAsync(long id, CancellationToken cancellationToken = default);

    Task RecordFailureAsync(long id, string errorCode, DateTimeOffset attemptedAtUtc, CancellationToken cancellationToken = default);
}
