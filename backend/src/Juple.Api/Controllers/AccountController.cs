using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.DeleteAccount;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

[ApiController]
[Route("api/v1/account")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class AccountController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IDeleteAccountService deleteAccountService) : ControllerBase
{
    /// <summary>
    /// Permanently deletes the current user's Juple account and all data Juple owns for it (see
    /// IDeleteAccountService/IAccountDeletionStore). Not soft delete, not recoverable. A second
    /// call with the same token after a first success hits CurrentJupleUserNotFoundException -
    /// the identity no longer resolves to a Juple user - which is the expected, existing 409
    /// semantics for this exception, not a bug.
    /// </summary>
    [HttpDelete]
    public async Task<IActionResult> DeleteAsync(CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            await deleteAccountService.DeleteAsync(currentUser.UserId, cancellationToken);
            return NoContent();
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
    }
}
