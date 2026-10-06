using Juple.Application.Identity;
using Juple.Domain.Users;

namespace Juple.Application.Users.BootstrapCurrentUser;

public interface ICurrentUserBootstrapService
{
    /// <summary>
    /// Returns the current user's Plan - the already-provisioned one when externalIdentity was bootstrapped before, or the
    /// newly-provisioned Free default otherwise - and the TimeZoneId now stored for them: the one time zone every date
    /// filter and calendar on the server uses (DailyInboxDateRangeCalculator), so a client can mean the same "today".
    /// </summary>
    Task<CurrentUserBootstrapResult> BootstrapAsync(
        ExternalIdentityPrincipal externalIdentity,
        BootstrapCurrentUserCommand command,
        CancellationToken cancellationToken = default);
}

/// <param name="TimeZoneId">The user's stored (canonical) IANA time zone after this bootstrap.</param>
public sealed record CurrentUserBootstrapResult(UserPlan Plan, string TimeZoneId);
