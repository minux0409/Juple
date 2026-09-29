namespace Juple.Application.Users.DeleteAccount;

public interface IDeleteAccountService
{
    Task DeleteAsync(long userId, CancellationToken cancellationToken = default);

    /// <summary>
    /// The user-facing deletion: only when the caller actually signed in again moments ago
    /// (authenticatedAtUtc is the server-verified auth_time of the current access token - see
    /// RecentAuthentication), otherwise RecentAuthenticationRequiredException and nothing is
    /// touched. What is deleted is exactly DeleteAsync.
    /// </summary>
    Task DeleteRecentlyAuthenticatedAsync(long userId, DateTimeOffset? authenticatedAtUtc, CancellationToken cancellationToken = default);
}
