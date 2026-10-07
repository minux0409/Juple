using Juple.Api.Authentication;
using Juple.Api.Collections;
using Juple.Application.Collections.Locking;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.DeleteAccount;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/account")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
public sealed class AccountController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IDeleteAccountService deleteAccountService) : ControllerBase
{
    /// <summary>
    /// Permanently deletes the current user's Juple account and all data Juple owns for it (see
    /// IDeleteAccountService/IAccountDeletionStore). Not soft delete, not recoverable. Requires a
    /// recent interactive sign-in: the access token's server-verified auth_time must be at most
    /// RecentAuthentication.MaxAge old, otherwise 403 recentAuthenticationRequired and nothing is
    /// deleted. A second call with the same token after a first success hits
    /// CurrentJupleUserNotFoundException first - the identity no longer resolves to a Juple user -
    /// which is the expected, existing 409 semantics for this exception, not a bug.
    /// </summary>
    [HttpDelete]
    public async Task<IActionResult> DeleteAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await deleteAccountService.DeleteRecentlyAuthenticatedAsync(
                currentUser.UserId, AuthenticationTimeClaim.Read(User), cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (RecentAuthenticationRequiredException)
        {
            return CollectionProblems.RecentAuthenticationRequired();
        }
    }
}
