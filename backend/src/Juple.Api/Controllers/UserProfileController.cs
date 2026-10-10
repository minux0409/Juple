using Juple.Api.Authentication;
using Juple.Application.Identity;
using Juple.Application.Images;
using Juple.Application.Users.CurrentUser;
using Juple.Application.Users.Profile;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Juple.Api.Controllers;

/// <summary>
/// The signed-in user's own profile: the optional nickname (editable), the Juple ID (read-only),
/// the profile photo (editable) and the sign-in method (read-only, from the access token). Never
/// an internal id. Every write is the caller's own row only - the user comes from the token, never
/// from the request.
/// </summary>
[ApiController]
[Route("api/v1/users/me/profile")]
[Authorize(Policy = AuthorizationPolicies.JupleUser)]
[Juple.Api.Billing.AllowWhenSubscriptionExpired]
public sealed class UserProfileController(
    IExternalIdentityAccessor externalIdentityAccessor,
    ICurrentJupleUserAccessor currentUserAccessor,
    IUserProfileService profileService) : ControllerBase
{
    [HttpGet]
    public Task<IActionResult> GetAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => profileService.GetAsync(userId, cancellationToken), cancellationToken);

    /// <summary>
    /// Sets the nickname (NFC, trimmed; empty or null clears it, so the Juple ID is shown instead).
    /// 400 with a stable "code" (nicknameTooLong, nicknameInvalidCharacters, nicknameReserved,
    /// nicknameProhibited) when rejected - nothing is stored.
    /// </summary>
    [HttpPut("display-name")]
    public Task<IActionResult> SetDisplayNameAsync(SetDisplayNameRequest request, CancellationToken cancellationToken) =>
        ExecuteAsync(userId => profileService.SetDisplayNameAsync(userId, request.DisplayName, cancellationToken), cancellationToken);

    /// <summary>
    /// The caller's profile photo (multipart field "file"; JPEG/PNG/WebP by magic bytes, at most
    /// 5MB - the app sends a ~512px resize). Replaces any previous photo, which stays in place if
    /// anything fails. Returns the updated profile (with a fresh ProfileImageUrl).
    /// </summary>
    [HttpPut("image")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(6 * 1024 * 1024)]
    public async Task<IActionResult> SetImageAsync(IFormFile? file, CancellationToken cancellationToken)
    {
        // Only the file's own bytes are used - never its client-supplied name or Content-Type.
        byte[]? content = null;
        if (file is not null && file.Length > 0)
        {
            using var memoryStream = new MemoryStream();
            await file.CopyToAsync(memoryStream, cancellationToken);
            content = memoryStream.ToArray();
        }

        return await ExecuteAsync(userId => profileService.SetProfileImageAsync(userId, content, cancellationToken), cancellationToken);
    }

    /// <summary>Back to the fallback avatar (idempotent). Returns the updated profile.</summary>
    [HttpDelete("image")]
    public Task<IActionResult> RemoveImageAsync(CancellationToken cancellationToken) =>
        ExecuteAsync(userId => profileService.RemoveProfileImageAsync(userId, cancellationToken), cancellationToken);

    private async Task<IActionResult> ExecuteAsync(Func<long, Task<UserProfileDto>> action, CancellationToken cancellationToken)
    {
        try
        {
            var currentUser = await currentUserAccessor.GetRequiredAsync(
                externalIdentityAccessor.GetRequired(), cancellationToken);
            var profile = await action(currentUser.UserId);
            return Ok(profile with { SignInMethod = SignInMethodClaim.Read(User) });
        }
        catch (CurrentJupleUserNotFoundException)
        {
            return Problem(
                statusCode: StatusCodes.Status409Conflict,
                title: "Juple user bootstrap is required.");
        }
        catch (InvalidDisplayNameException exception)
        {
            var problem = new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                ["displayName"] = [exception.Code],
            });
            problem.Extensions["code"] = exception.Code;
            return BadRequest(problem);
        }
        catch (InvalidItemImageException exception)
        {
            return BadRequest(new ValidationProblemDetails(new Dictionary<string, string[]>
            {
                [exception.Field] = [exception.Message],
            }));
        }
    }

    public sealed record SetDisplayNameRequest(string? DisplayName);
}
