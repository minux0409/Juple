using Juple.Application.Identity;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserProvisioningStore
{
    Task<bool> ExternalIdentityExistsAsync(
        ExternalIdentityPrincipal externalIdentity,
        CancellationToken cancellationToken = default);

    Task CreateOrGetAsync(
        CurrentUserBootstrapData data,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// When a User already exists for this external identity, best-effort updates its stored
    /// TimeZoneId to timeZoneId (only writing when it actually differs) and returns true. Returns
    /// false when no User exists yet for this identity, signaling the caller to provision one via
    /// CreateOrGetAsync instead.
    /// </summary>
    Task<bool> TrySyncTimeZoneIfExistingAsync(
        ExternalIdentityPrincipal externalIdentity,
        string timeZoneId,
        DateTimeOffset updatedAtUtc,
        CancellationToken cancellationToken = default);
}