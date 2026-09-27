using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.Profile;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in user's own public-facing profile: the optional display name (editable) and the
/// Juple ID (read-only). Only these two values are ever returned - never an internal id or email.
/// </summary>
[ApiController]
[Route("api/v1/users/me/profile")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
public sealed class UserProfileController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IUserProfileService profileService) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> GetAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => profileService.GetAsync(userId, cancellationToken), cancellationToken);

    /// <summary>Sets the display name (trimmed; empty or null clears it, so the Juple ID is shown instead).</summary>
    [HttpPut("display-name")]
    public Task<IActionResult> SetDisplayNameAsync(SetDisplayNameRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(userId => profileService.SetDisplayNameAsync(userId, request.DisplayName, cancellationToken), cancellationToken);

    private async Task<IActionResult> ExecuteAsync(Func<long, Task<UserProfileDto>> action, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            return Ok(await action(currentUser.UserId));
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (InvalidDisplayNameException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["displayName"] = [exception.Message],
            }));
        }
    }

    public sealed record SetDisplayNameRequest(string? DisplayName);
}
